// db-d1.js — Cloudflare D1 数据访问层
// ------------------------------------------------------------------
// 用于部署到 Cloudflare Workers + D1 的场景（替代原 db.js 的
// node:sqlite / pg 分支）。D1 兼容 SQLite 语法，占位符统一用 ?，
// 支持 INSERT OR IGNORE / 外键级联，业务代码接口与 db.js 一致：
//   query / get / run / exec
// 注意：D1 没有「事务回调」概念，原 server.js 里的 db.transaction(...)
// 在 worker.js 中改为「顺序 run」，小应用足够且更简单可靠。
//
// 用法：const db = createDb(env.DB);

export function createDb(DB) {
  async function query(sql, params = []) {
    const r = await DB.prepare(sql).bind(...params).all();
    return r.results || [];
  }

  async function get(sql, params = []) {
    const row = await DB.prepare(sql).bind(...params).first();
    return row || undefined;
  }

  async function run(sql, params = []) {
    const r = await DB.prepare(sql).bind(...params).run();
    return {
      lastID: r.meta && r.meta.last_row_id != null ? Number(r.meta.last_row_id) : undefined,
      changes: r.meta && r.meta.changes != null ? Number(r.meta.changes) : 0
    };
  }

  async function exec(sql) {
    // D1 的 exec 支持多条用 ; 分隔的语句（建表用）
    await DB.exec(sql);
  }

  return { query, get, run, exec, mode: 'd1' };
}
