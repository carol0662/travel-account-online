// _worker.js — Cloudflare Pages 边缘函数入口（多人旅游记账 · 联网共享版）
// ------------------------------------------------------------------
//  - 前端 public/ 由 Pages Static Assets 提供（绑定名 ASSETS）
//  - /api/* 由本 Worker 处理
//  - 数据存 Cloudflare D1（绑定名 DB），建表在首次请求时自动完成
//
// 部署：Cloudflare 控制台 Pages → 连接 GitHub → 输出目录 public（见 README）

import { createDb } from './db-d1.js';

// 建表语句（D1 = SQLite 语法）。首次请求时执行，幂等。
const CREATE_SQL = `
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

// ---------------------------------------------------------------- 工具
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

function nowStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// 生成 6 位唯一邀请码（字母+数字，去除易混字符）
async function genCode(DB) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 20; attempt++) {
    const buf = new Uint32Array(6);
    crypto.getRandomValues(buf);
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[buf[i] % chars.length];
    const exists = await DB.prepare('SELECT id FROM trips WHERE code = ?').bind(code).first();
    if (!exists) return code;
  }
  const fb = new Uint32Array(2);
  crypto.getRandomValues(fb);
  return (fb[0].toString(36) + fb[1].toString(36)).toUpperCase().slice(0, 8);
}

// ---------------------------------------------------------------- 结算算法
async function computeSettlement(db, tripId) {
  const members = await db.query(
    'SELECT id, name, created_by FROM members WHERE trip_id = ? ORDER BY id',
    [tripId]
  );
  const memberMap = {};
  members.forEach((m) => { memberMap[m.id] = m.name; });

  const expenses = await db.query(
    'SELECT e.id, e.payer_id, e.amount FROM expenses e WHERE e.trip_id = ? ORDER BY e.id',
    [tripId]
  );

  const sharerRows = await db.query(
    `SELECT s.expense_id, s.member_id
     FROM expense_sharers s JOIN expenses e ON e.id = s.expense_id
     WHERE e.trip_id = ?`,
    [tripId]
  );

  const sharersByExpense = {};
  sharerRows.forEach((r) => {
    (sharersByExpense[r.expense_id] ||= []).push(r.member_id);
  });

  const paid = {};
  const share = {};
  members.forEach((m) => { paid[m.id] = 0; share[m.id] = 0; });

  expenses.forEach((e) => {
    const amt = Number(e.amount) || 0;
    if (paid[e.payer_id] !== undefined) paid[e.payer_id] += amt;
    const list = sharersByExpense[e.id] || [];
    if (list.length === 0) return;
    const per = amt / list.length;
    list.forEach((mid) => {
      if (share[mid] !== undefined) share[mid] += per;
    });
  });

  const summary = members.map((m) => {
    const p = round2(paid[m.id]);
    const s = round2(share[m.id]);
    const net = round2(p - s);
    let role = '平衡';
    if (net > 0) role = '应收';
    else if (net < 0) role = '应付';
    return { id: m.id, name: m.name, paid: p, share: s, net, role, created_by: m.created_by };
  });

  const creditors = summary.filter((x) => x.net > 0)
    .map((x) => ({ id: x.id, name: x.name, amt: x.net }))
    .sort((a, b) => b.amt - a.amt);
  const debtors = summary.filter((x) => x.net < 0)
    .map((x) => ({ id: x.id, name: x.name, amt: -x.net }))
    .sort((a, b) => b.amt - a.amt);

  const transactions = [];
  let i = 0, j = 0;
  while (i < creditors.length && j < debtors.length) {
    const c = creditors[i];
    const d = debtors[j];
    const pay = round2(Math.min(c.amt, d.amt));
    if (pay > 0) {
      transactions.push({
        fromId: d.id, fromName: d.name,
        toId: c.id, toName: c.name,
        amount: pay
      });
    }
    c.amt = round2(c.amt - pay);
    d.amt = round2(d.amt - pay);
    if (c.amt <= 0.005) i++;
    if (d.amt <= 0.005) j++;
  }

  return { summary, transactions };
}

// ---------------------------------------------------------------- 路由
async function handleApi(request, env, url) {
  const db = createDb(env.DB);
  const method = request.method;
  const p = url.pathname;

  const body = () => request.json().catch(() => ({}));

  // ---- 行程列表 ----
  if (method === 'GET' && p === '/api/trips') {
    const rows = await db.query(
      'SELECT id, name, code, created_at FROM trips ORDER BY created_at DESC, id DESC'
    );
    return json({ ok: true, data: rows });
  }

  // 按邀请码查询行程
  let m = p.match(/^\/api\/trips\/code\/([A-Za-z0-9]+)$/);
  if (m && method === 'GET') {
    const code = m[1].toUpperCase();
    const trip = await db.get(
      'SELECT id, name, code, created_at FROM trips WHERE code = ?',
      [code]
    );
    if (!trip) return json({ ok: false, msg: '邀请码无效或行程不存在' }, 404);
    return json({ ok: true, data: trip });
  }

  // 新建行程
  if (method === 'POST' && p === '/api/trips') {
    const b = await body();
    const name = (b.name || '').trim();
    if (!name) return json({ ok: false, msg: '行程名称不能为空' }, 400);
    const code = await genCode(env.DB);
    const info = await db.run(
      'INSERT INTO trips (name, code, created_at) VALUES (?, ?, ?)',
      [name, code, nowStr()]
    );
    return json({ ok: true, data: { id: info.lastID, name, code, created_at: nowStr() } });
  }

  // /api/trips/:id
  m = p.match(/^\/api\/trips\/(\d+)$/);
  if (m) {
    const tripId = Number(m[1]);
    if (method === 'GET') {
      const trip = await db.get(
        'SELECT id, name, code, created_at FROM trips WHERE id = ?',
        [tripId]
      );
      if (!trip) return json({ ok: false, msg: '行程不存在' }, 404);
      const members = await db.query(
        'SELECT id, name, created_by FROM members WHERE trip_id = ? ORDER BY id',
        [tripId]
      );
      const expenses = await db.query(
        `SELECT id, payer_id, amount, pay_method, note, paid_at
         FROM expenses WHERE trip_id = ? ORDER BY paid_at DESC, id DESC`,
        [tripId]
      );
      const sharerRows = await db.query(
        `SELECT s.expense_id, s.member_id
         FROM expense_sharers s JOIN expenses e ON e.id = s.expense_id
         WHERE e.trip_id = ?`,
        [tripId]
      );
      const sharersByExpense = {};
      sharerRows.forEach((r) => { (sharersByExpense[r.expense_id] ||= []).push(r.member_id); });
      expenses.forEach((e) => { e.sharers = sharersByExpense[e.id] || []; });
      return json({ ok: true, data: { trip, members, expenses } });
    }
    if (method === 'PUT') {
      const b = await body();
      const name = (b.name || '').trim();
      if (!name) return json({ ok: false, msg: '行程名称不能为空' }, 400);
      const info = await db.run('UPDATE trips SET name = ? WHERE id = ?', [name, tripId]);
      if (info.changes === 0) return json({ ok: false, msg: '行程不存在' }, 404);
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      // 手动级联删除（双保险，D1 外键级联已设）
      await db.run('DELETE FROM expense_sharers WHERE expense_id IN (SELECT id FROM expenses WHERE trip_id = ?)', [tripId]);
      await db.run('DELETE FROM expenses WHERE trip_id = ?', [tripId]);
      await db.run('DELETE FROM members WHERE trip_id = ?', [tripId]);
      await db.run('DELETE FROM trips WHERE id = ?', [tripId]);
      return json({ ok: true });
    }
  }

  // /api/trips/:id/members
  m = p.match(/^\/api\/trips\/(\d+)\/members$/);
  if (m && method === 'POST') {
    const tripId = Number(m[1]);
    const b = await body();
    const name = (b.name || '').trim();
    const created_by = (b.created_by || '').trim() || null;
    if (!name) return json({ ok: false, msg: '姓名不能为空' }, 400);
    const trip = await db.get('SELECT id FROM trips WHERE id = ?', [tripId]);
    if (!trip) return json({ ok: false, msg: '行程不存在' }, 404);
    const info = await db.run(
      'INSERT INTO members (trip_id, name, created_by) VALUES (?, ?, ?)',
      [tripId, name, created_by]
    );
    return json({ ok: true, data: { id: info.lastID, name, created_by } });
  }

  // /api/members/:id
  m = p.match(/^\/api\/members\/(\d+)$/);
  if (m) {
    const memberId = Number(m[1]);
    if (method === 'PUT') {
      const b = await body();
      const name = (b.name || '').trim();
      if (!name) return json({ ok: false, msg: '姓名不能为空' }, 400);
      const info = await db.run('UPDATE members SET name = ? WHERE id = ?', [name, memberId]);
      if (info.changes === 0) return json({ ok: false, msg: '成员不存在' }, 404);
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      const asPayer = await db.get('SELECT COUNT(*) AS c FROM expenses WHERE payer_id = ?', [memberId]);
      if (asPayer.c > 0) {
        return json({ ok: false, msg: '该成员已存在付款记录，无法删除（可先删除其支出）' }, 400);
      }
      await db.run('DELETE FROM expense_sharers WHERE member_id = ?', [memberId]);
      const info = await db.run('DELETE FROM members WHERE id = ?', [memberId]);
      if (info.changes === 0) return json({ ok: false, msg: '成员不存在' }, 404);
      return json({ ok: true });
    }
  }

  // /api/trips/:id/expenses
  m = p.match(/^\/api\/trips\/(\d+)\/expenses$/);
  if (m && method === 'POST') {
    const tripId = Number(m[1]);
    const b = await body();
    const payer_id = Number(b.payer_id);
    const amount = Number(b.amount);
    const pay_method = (b.pay_method || '其他').trim();
    const note = (b.note || '').trim();
    const paid_at = (b.paid_at || '').trim() || nowStr();
    let sharer_ids = Array.isArray(b.sharer_ids) ? b.sharer_ids.map(Number) : [];

    if (!payer_id) return json({ ok: false, msg: '请选择付款人' }, 400);
    if (!(amount > 0)) return json({ ok: false, msg: '金额必须大于 0' }, 400);
    if (sharer_ids.length === 0) return json({ ok: false, msg: '请至少选择一名分摊人员' }, 400);

    const trip = await db.get('SELECT id FROM trips WHERE id = ?', [tripId]);
    if (!trip) return json({ ok: false, msg: '行程不存在' }, 404);
    const payer = await db.get('SELECT id FROM members WHERE id = ? AND trip_id = ?', [payer_id, tripId]);
    if (!payer) return json({ ok: false, msg: '付款人不在该行程中' }, 400);
    const validMembers = (await db.query('SELECT id FROM members WHERE trip_id = ?', [tripId])).map((x) => x.id);
    const validSet = new Set(validMembers);
    sharer_ids = sharer_ids.filter((id) => validSet.has(id));
    if (sharer_ids.length === 0) return json({ ok: false, msg: '分摊人员无效' }, 400);

    const info = await db.run(
      'INSERT INTO expenses (trip_id, payer_id, amount, pay_method, note, paid_at) VALUES (?, ?, ?, ?, ?, ?)',
      [tripId, payer_id, amount, pay_method, note, paid_at]
    );
    const expId = info.lastID;
    for (const mid of sharer_ids) {
      await db.run(
        'INSERT OR IGNORE INTO expense_sharers (expense_id, member_id) VALUES (?, ?)',
        [expId, mid]
      );
    }
    return json({ ok: true, data: { id: expId } });
  }

  // /api/expenses/:id
  m = p.match(/^\/api\/expenses\/(\d+)$/);
  if (m) {
    const expId = Number(m[1]);
    if (method === 'PUT') {
      const b = await body();
      const payer_id = Number(b.payer_id);
      const amount = Number(b.amount);
      const pay_method = (b.pay_method || '其他').trim();
      const note = (b.note || '').trim();
      const paid_at = (b.paid_at || '').trim() || nowStr();
      let sharer_ids = Array.isArray(b.sharer_ids) ? b.sharer_ids.map(Number) : [];
      if (!payer_id) return json({ ok: false, msg: '请选择付款人' }, 400);
      if (!(amount > 0)) return json({ ok: false, msg: '金额必须大于 0' }, 400);
      if (sharer_ids.length === 0) return json({ ok: false, msg: '请至少选择一名分摊人员' }, 400);

      const exp = await db.get('SELECT id, trip_id FROM expenses WHERE id = ?', [expId]);
      if (!exp) return json({ ok: false, msg: '支出记录不存在' }, 404);
      const validMembers = (await db.query('SELECT id FROM members WHERE trip_id = ?', [exp.trip_id])).map((x) => x.id);
      const validSet = new Set(validMembers);
      sharer_ids = sharer_ids.filter((id) => validSet.has(id));
      if (sharer_ids.length === 0) return json({ ok: false, msg: '分摊人员无效' }, 400);

      await db.run(
        'UPDATE expenses SET payer_id=?, amount=?, pay_method=?, note=?, paid_at=? WHERE id=?',
        [payer_id, amount, pay_method, note, paid_at, expId]
      );
      await db.run('DELETE FROM expense_sharers WHERE expense_id = ?', [expId]);
      for (const mid of sharer_ids) {
        await db.run(
          'INSERT OR IGNORE INTO expense_sharers (expense_id, member_id) VALUES (?, ?)',
          [expId, mid]
        );
      }
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      await db.run('DELETE FROM expenses WHERE id = ?', [expId]);
      return json({ ok: true });
    }
  }

  // /api/trips/:id/settle
  m = p.match(/^\/api\/trips\/(\d+)\/settle$/);
  if (m && method === 'GET') {
    const tripId = Number(m[1]);
    const trip = await db.get('SELECT id, name FROM trips WHERE id = ?', [tripId]);
    if (!trip) return json({ ok: false, msg: '行程不存在' }, 404);
    const result = await computeSettlement(db, tripId);
    return json({ ok: true, data: { tripName: trip.name, ...result } });
  }

  return json({ ok: false, msg: '接口不存在' }, 404);
}

// ---------------------------------------------------------------- 入口
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    // 确保表存在（幂等）
    try {
      await env.DB.exec(CREATE_SQL);
      await env.DB.exec('PRAGMA foreign_keys = ON;');
    } catch (e) {
      // 表已存在或 PRAGMA 不支持时忽略
    }

    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (e) {
        return json({ ok: false, msg: '服务器错误：' + e.message }, 500);
      }
    }

    // 静态资源（前端 public/）
    return env.ASSETS.fetch(request);
  }
};
