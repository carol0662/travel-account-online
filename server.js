'use strict';

/**
 * 多人旅游记账 APP —— 联网共享版后端
 * 技术栈：Node.js 内置 http + 统一数据层（Postgres / SQLite 自动切换）
 *
 * 特点：
 *  - 有 DATABASE_URL 时用 Postgres（部署到 Render 等云平台，数据持久化）
 *  - 无 DATABASE_URL 时用 Node 内置 SQLite（本地开发，零第三方依赖）
 *  - 每个行程带一个「邀请码 code」，同伴用邀请码即可加入同一行程
 *  - 每个成员记录 created_by（创建者的设备 userId），用于「默认付款人=自己」
 *
 * 启动：node --experimental-sqlite server.js  （或 npm start）
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------------------------------------------------------------- 通用工具
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) reject(new Error('请求体过大'));
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error('JSON 解析失败'));
      }
    });
    req.on('error', reject);
  });
}

function nowStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// 生成 6 位唯一邀请码（字母+数字，去除易混字符）
async function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[crypto.randomInt(0, chars.length)];
    }
    const exists = await db.get('SELECT id FROM trips WHERE code = ?', [code]);
    if (!exists) return code;
  }
  return crypto.randomBytes(6).toString('hex').toUpperCase().slice(0, 8);
}

// ---------------------------------------------------------------- 结算算法
async function computeSettlement(tripId) {
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

// ---------------------------------------------------------------- 路由分发
async function handleApi(req, res, url) {
  const method = req.method;
  const p = url.pathname;

  // ---- 行程列表 ----
  if (method === 'GET' && p === '/api/trips') {
    const rows = await db.query(
      'SELECT id, name, code, created_at FROM trips ORDER BY created_at DESC, id DESC'
    );
    return sendJSON(res, 200, { ok: true, data: rows });
  }

  // 按邀请码查询行程（用于加入）
  let m = p.match(/^\/api\/trips\/code\/([A-Za-z0-9]+)$/);
  if (m && method === 'GET') {
    const code = m[1].toUpperCase();
    const trip = await db.get(
      'SELECT id, name, code, created_at FROM trips WHERE code = ?',
      [code]
    );
    if (!trip) return sendJSON(res, 404, { ok: false, msg: '邀请码无效或行程不存在' });
    return sendJSON(res, 200, { ok: true, data: trip });
  }

  // 新建行程（生成邀请码）
  if (method === 'POST' && p === '/api/trips') {
    const body = await readBody(req);
    const name = (body.name || '').trim();
    if (!name) return sendJSON(res, 400, { ok: false, msg: '行程名称不能为空' });
    const code = await genCode();
    const info = await db.run(
      'INSERT INTO trips (name, code, created_at) VALUES (?, ?, ?)',
      [name, code, nowStr()]
    );
    return sendJSON(res, 200, {
      ok: true,
      data: { id: info.lastID, name, code, created_at: nowStr() }
    });
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
      if (!trip) return sendJSON(res, 404, { ok: false, msg: '行程不存在' });
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
      return sendJSON(res, 200, { ok: true, data: { trip, members, expenses } });
    }
    if (method === 'PUT') {
      const body = await readBody(req);
      const name = (body.name || '').trim();
      if (!name) return sendJSON(res, 400, { ok: false, msg: '行程名称不能为空' });
      const info = await db.run('UPDATE trips SET name = ? WHERE id = ?', [name, tripId]);
      if (info.changes === 0) return sendJSON(res, 404, { ok: false, msg: '行程不存在' });
      return sendJSON(res, 200, { ok: true });
    }
    if (method === 'DELETE') {
      await db.run('DELETE FROM trips WHERE id = ?', [tripId]);
      return sendJSON(res, 200, { ok: true });
    }
  }

  // /api/trips/:id/members
  m = p.match(/^\/api\/trips\/(\d+)\/members$/);
  if (m && method === 'POST') {
    const tripId = Number(m[1]);
    const body = await readBody(req);
    const name = (body.name || '').trim();
    const created_by = (body.created_by || '').trim() || null;
    if (!name) return sendJSON(res, 400, { ok: false, msg: '姓名不能为空' });
    const trip = await db.get('SELECT id FROM trips WHERE id = ?', [tripId]);
    if (!trip) return sendJSON(res, 404, { ok: false, msg: '行程不存在' });
    const info = await db.run(
      'INSERT INTO members (trip_id, name, created_by) VALUES (?, ?, ?)',
      [tripId, name, created_by]
    );
    return sendJSON(res, 200, { ok: true, data: { id: info.lastID, name, created_by } });
  }

  // /api/members/:id
  m = p.match(/^\/api\/members\/(\d+)$/);
  if (m) {
    const memberId = Number(m[1]);
    if (method === 'PUT') {
      const body = await readBody(req);
      const name = (body.name || '').trim();
      if (!name) return sendJSON(res, 400, { ok: false, msg: '姓名不能为空' });
      const info = await db.run('UPDATE members SET name = ? WHERE id = ?', [name, memberId]);
      if (info.changes === 0) return sendJSON(res, 404, { ok: false, msg: '成员不存在' });
      return sendJSON(res, 200, { ok: true });
    }
    if (method === 'DELETE') {
      const asPayer = await db.get('SELECT COUNT(*) AS c FROM expenses WHERE payer_id = ?', [memberId]);
      if (asPayer.c > 0) {
        return sendJSON(res, 400, { ok: false, msg: '该成员已存在付款记录，无法删除（可先删除其支出）' });
      }
      await db.run('DELETE FROM expense_sharers WHERE member_id = ?', [memberId]);
      const info = await db.run('DELETE FROM members WHERE id = ?', [memberId]);
      if (info.changes === 0) return sendJSON(res, 404, { ok: false, msg: '成员不存在' });
      return sendJSON(res, 200, { ok: true });
    }
  }

  // /api/trips/:id/expenses
  m = p.match(/^\/api\/trips\/(\d+)\/expenses$/);
  if (m && method === 'POST') {
    const tripId = Number(m[1]);
    const body = await readBody(req);
    const payer_id = Number(body.payer_id);
    const amount = Number(body.amount);
    const pay_method = (body.pay_method || '其他').trim();
    const note = (body.note || '').trim();
    const paid_at = (body.paid_at || '').trim() || nowStr();
    let sharer_ids = Array.isArray(body.sharer_ids) ? body.sharer_ids.map(Number) : [];

    if (!payer_id) return sendJSON(res, 400, { ok: false, msg: '请选择付款人' });
    if (!(amount > 0)) return sendJSON(res, 400, { ok: false, msg: '金额必须大于 0' });
    if (sharer_ids.length === 0) return sendJSON(res, 400, { ok: false, msg: '请至少选择一名分摊人员' });

    const trip = await db.get('SELECT id FROM trips WHERE id = ?', [tripId]);
    if (!trip) return sendJSON(res, 404, { ok: false, msg: '行程不存在' });
    const payer = await db.get('SELECT id FROM members WHERE id = ? AND trip_id = ?', [payer_id, tripId]);
    if (!payer) return sendJSON(res, 400, { ok: false, msg: '付款人不在该行程中' });
    const validMembers = (await db.query('SELECT id FROM members WHERE trip_id = ?', [tripId])).map((x) => x.id);
    const validSet = new Set(validMembers);
    sharer_ids = sharer_ids.filter((id) => validSet.has(id));
    if (sharer_ids.length === 0) return sendJSON(res, 400, { ok: false, msg: '分摊人员无效' });

    try {
      const result = await db.transaction(async (tx) => {
        const info = await tx.run(
          'INSERT INTO expenses (trip_id, payer_id, amount, pay_method, note, paid_at) VALUES (?, ?, ?, ?, ?, ?)',
          [tripId, payer_id, amount, pay_method, note, paid_at]
        );
        const expId = info.lastID;
        for (const mid of sharer_ids) {
          await tx.run(
            'INSERT OR IGNORE INTO expense_sharers (expense_id, member_id) VALUES (?, ?)',
            [expId, mid]
          );
        }
        return expId;
      });
      return sendJSON(res, 200, { ok: true, data: { id: result } });
    } catch (e) {
      return sendJSON(res, 500, { ok: false, msg: '保存失败：' + e.message });
    }
  }

  // /api/expenses/:id
  m = p.match(/^\/api\/expenses\/(\d+)$/);
  if (m) {
    const expId = Number(m[1]);
    if (method === 'PUT') {
      const body = await readBody(req);
      const payer_id = Number(body.payer_id);
      const amount = Number(body.amount);
      const pay_method = (body.pay_method || '其他').trim();
      const note = (body.note || '').trim();
      const paid_at = (body.paid_at || '').trim() || nowStr();
      let sharer_ids = Array.isArray(body.sharer_ids) ? body.sharer_ids.map(Number) : [];
      if (!payer_id) return sendJSON(res, 400, { ok: false, msg: '请选择付款人' });
      if (!(amount > 0)) return sendJSON(res, 400, { ok: false, msg: '金额必须大于 0' });
      if (sharer_ids.length === 0) return sendJSON(res, 400, { ok: false, msg: '请至少选择一名分摊人员' });

      const exp = await db.get('SELECT id, trip_id FROM expenses WHERE id = ?', [expId]);
      if (!exp) return sendJSON(res, 404, { ok: false, msg: '支出记录不存在' });
      const validMembers = (await db.query('SELECT id FROM members WHERE trip_id = ?', [exp.trip_id])).map((x) => x.id);
      const validSet = new Set(validMembers);
      sharer_ids = sharer_ids.filter((id) => validSet.has(id));
      if (sharer_ids.length === 0) return sendJSON(res, 400, { ok: false, msg: '分摊人员无效' });

      try {
        await db.transaction(async (tx) => {
          await tx.run(
            'UPDATE expenses SET payer_id=?, amount=?, pay_method=?, note=?, paid_at=? WHERE id=?',
            [payer_id, amount, pay_method, note, paid_at, expId]
          );
          await tx.run('DELETE FROM expense_sharers WHERE expense_id = ?', [expId]);
          for (const mid of sharer_ids) {
            await tx.run(
              'INSERT OR IGNORE INTO expense_sharers (expense_id, member_id) VALUES (?, ?)',
              [expId, mid]
            );
          }
        });
        return sendJSON(res, 200, { ok: true });
      } catch (e) {
        return sendJSON(res, 500, { ok: false, msg: '保存失败：' + e.message });
      }
    }
    if (method === 'DELETE') {
      await db.run('DELETE FROM expenses WHERE id = ?', [expId]);
      return sendJSON(res, 200, { ok: true });
    }
  }

  // /api/trips/:id/settle
  m = p.match(/^\/api\/trips\/(\d+)\/settle$/);
  if (m && method === 'GET') {
    const tripId = Number(m[1]);
    const trip = await db.get('SELECT id, name FROM trips WHERE id = ?', [tripId]);
    if (!trip) return sendJSON(res, 404, { ok: false, msg: '行程不存在' });
    const result = await computeSettlement(tripId);
    return sendJSON(res, 200, { ok: true, data: { tripName: trip.name, ...result } });
  }

  return sendJSON(res, 404, { ok: false, msg: '接口不存在' });
}

// ---------------------------------------------------------------- 静态文件
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';

  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------------------------------------------------------------- 启动
const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((e) => {
      console.error(e);
      sendJSON(res, 500, { ok: false, msg: '服务器错误：' + e.message });
    });
    return;
  }
  serveStatic(req, res, url);
});

async function start() {
  await db.init();
  server.listen(PORT, '0.0.0.0', () => {
    console.log('==================================================');
    console.log('  多人旅游记账 APP（联网共享版）已启动');
    console.log(`  本地访问： http://localhost:${PORT}`);
    console.log(`  数据后端： ${db.getMode()}`);
    console.log('==================================================');
  });
}

start().catch((e) => {
  console.error('启动失败：', e);
  process.exit(1);
});
