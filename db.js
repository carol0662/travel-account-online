'use strict';

/**
 * 统一数据访问层
 * ------------------------------------------------------------------
 * 根据环境变量 DATABASE_URL 自动选择后端：
 *   - 有 DATABASE_URL  → 使用 Postgres（pg 驱动），数据持久化在托管数据库
 *   - 无 DATABASE_URL  → 使用 Node 内置 SQLite（node:sqlite），零依赖本地开发
 *
 * 业务代码统一调用：query / get / run / exec / transaction
 * 占位符统一用 ?（Postgres 模式内部转换为 $1, $2 ...）
 */

const fs = require('fs');
const path = require('path');

let mode = 'sqlite';
let sqliteDb = null;
let pgPool = null;

// ---------------------------------------------------------------- 初始化
async function init() {
  const url = process.env.DATABASE_URL;
  if (url) {
    mode = 'postgres';
    const { Pool } = require('pg');
    pgPool = new Pool({
      connectionString: url,
      ssl: /render\.com|amazonaws\.com|rds|supabase/i.test(url)
        ? { rejectUnauthorized: false }
        : false,
      max: 10
    });
    await pgPool.query('SELECT 1');
    console.log('[db] 已连接 Postgres');
  } else {
    mode = 'sqlite';
    const { DatabaseSync } = require('node:sqlite');
    const DATA_DIR = path.join(__dirname, 'data');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    sqliteDb = new DatabaseSync(path.join(DATA_DIR, 'travel.db'));
    sqliteDb.exec('PRAGMA foreign_keys = ON;');
    console.log('[db] 使用本地 SQLite（未设置 DATABASE_URL）');
  }
  await createTables();
}

function getMode() {
  return mode;
}

// ---------------------------------------------------------------- 表结构
function ddl() {
  if (mode === 'sqlite') {
    return `
      CREATE TABLE IF NOT EXISTS trips (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        code       TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS members (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        trip_id    INTEGER NOT NULL,
        name       TEXT NOT NULL,
        created_by TEXT,
        FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS expenses (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        trip_id    INTEGER NOT NULL,
        payer_id   INTEGER NOT NULL,
        amount     REAL NOT NULL,
        pay_method TEXT NOT NULL,
        note       TEXT,
        paid_at    TEXT NOT NULL,
        FOREIGN KEY (trip_id)  REFERENCES trips(id) ON DELETE CASCADE,
        FOREIGN KEY (payer_id) REFERENCES members(id)
      );
      CREATE TABLE IF NOT EXISTS expense_sharers (
        expense_id INTEGER NOT NULL,
        member_id  INTEGER NOT NULL,
        PRIMARY KEY (expense_id, member_id),
        FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE,
        FOREIGN KEY (member_id)  REFERENCES members(id) ON DELETE CASCADE
      );
    `;
  }
  // Postgres
  return `
    CREATE TABLE IF NOT EXISTS trips (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL,
      code       TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS members (
      id         SERIAL PRIMARY KEY,
      trip_id    INTEGER NOT NULL,
      name       TEXT NOT NULL,
      created_by TEXT,
      FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS expenses (
      id         SERIAL PRIMARY KEY,
      trip_id    INTEGER NOT NULL,
      payer_id   INTEGER NOT NULL,
      amount     REAL NOT NULL,
      pay_method TEXT NOT NULL,
      note       TEXT,
      paid_at    TEXT NOT NULL,
      FOREIGN KEY (trip_id)  REFERENCES trips(id) ON DELETE CASCADE,
      FOREIGN KEY (payer_id) REFERENCES members(id)
    );
    CREATE TABLE IF NOT EXISTS expense_sharers (
      expense_id INTEGER NOT NULL,
      member_id  INTEGER NOT NULL,
      PRIMARY KEY (expense_id, member_id),
      FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE,
      FOREIGN KEY (member_id)  REFERENCES members(id) ON DELETE CASCADE
    );
  `;
}

async function createTables() {
  const sql = ddl();
  if (mode === 'sqlite') {
    sqliteDb.exec(sql);
  } else {
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
      await pgPool.query(stmt);
    }
  }
}

// ---------------------------------------------------------------- 参数转换（? → $1）
function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// 处理 INSERT OR IGNORE（SQLite）→ ON CONFLICT DO NOTHING（Postgres）
function pgInsertTransform(sql) {
  let s = sql.replace(/insert or ignore into/i, 'INSERT INTO');
  const ignore = /ON CONFLICT/.test(s) === false && /insert into/i.test(s) &&
    /do nothing/i.test(sql) === false && /\bor ignore\b/i.test(sql);
  return { sql: s, isIgnore: /\bor ignore\b/i.test(sql) };
}

// 统一执行一次写操作（返回 {lastID, changes}）
async function runOne(pgClient, sql, params) {
  if (mode === 'sqlite') {
    const info = sqliteDb.prepare(sql).run(...(params || []));
    return { lastID: Number(info.lastInsertRowid), changes: info.changes };
  }
  let s = sql;
  const isIgnore = /insert or ignore/i.test(s);
  s = s.replace(/insert or ignore into/i, 'INSERT INTO');
  let returning = false;
  if (!isIgnore && /^\s*insert\s+into/i.test(s) && !/returning/i.test(s)) {
    s += ' RETURNING id';
    returning = true;
  }
  s = toPg(s);
  if (isIgnore) s += ' ON CONFLICT DO NOTHING';
  const r = await (pgClient || pgPool).query(s, params || []);
  if (returning) return { lastID: Number(r.rows[0].id), changes: r.rowCount };
  return { lastID: undefined, changes: r.rowCount };
}

// ---------------------------------------------------------------- 对外接口
async function query(sql, params) {
  if (mode === 'sqlite') {
    return sqliteDb.prepare(sql).all(...(params || []));
  }
  const r = await pgPool.query(toPg(sql), params || []);
  return r.rows;
}

async function get(sql, params) {
  if (mode === 'sqlite') {
    return sqliteDb.prepare(sql).get(...(params || []));
  }
  const r = await pgPool.query(toPg(sql), params || []);
  return r.rows[0];
}

async function run(sql, params) {
  return runOne(null, sql, params);
}

async function exec(sql) {
  if (mode === 'sqlite') {
    sqliteDb.exec(sql);
  } else {
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
      await pgPool.query(stmt);
    }
  }
}

// 事务：fn 收到 tx 对象（含 query/get/run），SQLite 与 Postgres 均在同一连接
async function transaction(fn) {
  if (mode === 'sqlite') {
    sqliteDb.exec('BEGIN');
    try {
      const tx = {
        query: (s, p) => Promise.resolve(sqliteDb.prepare(s).all(...(p || []))),
        get: (s, p) => Promise.resolve(sqliteDb.prepare(s).get(...(p || []))),
        run: (s, p) => {
          const info = sqliteDb.prepare(s).run(...(p || []));
          return Promise.resolve({ lastID: Number(info.lastInsertRowid), changes: info.changes });
        }
      };
      const r = await fn(tx);
      sqliteDb.exec('COMMIT');
      return r;
    } catch (e) {
      sqliteDb.exec('ROLLBACK');
      throw e;
    }
  }
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    const tx = {
      query: (s, p) => client.query(toPg(s), p || []).then((r) => r.rows),
      get: (s, p) => client.query(toPg(s), p || []).then((r) => r.rows[0]),
      run: (s, p) => runOne(client, s, p)
    };
    const r = await fn(tx);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { init, query, get, run, exec, transaction, getMode };
