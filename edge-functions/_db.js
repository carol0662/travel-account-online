// EdgeOne Makers 共享数据层（基于 Blob 存储，无需人工审批，部署即用）
// 所有业务函数都接收一个「KV 接口风格」的存储实例（见 makeKVAdapter），
// 方便在本地用内存模拟器测试，也方便日后切换底层存储。
//
// Blob 键设计（每个实体独立 key，写入互不影响，降低最终一致性下的并发覆盖风险）：
//   trip:<id>                    -> {id,name,created_at,code}
//   code:<code>                 -> tripId
//   mem:<tripId>:<memberId>     -> {id,trip_id,name,created_by}
//   exp:<tripId>:<expenseId>    -> {id,trip_id,payer_id,amount,pay_method,note,paid_at}
//   shr:<tripId>:<expenseId>:<memberId> -> "1"
//
// 为什么用 Blob 而不是 KV：Blob 是「即用即得」，首次 getStore 自动创建命名空间，
// 不需要在控制台申请开通 + 等人工审批；API 与 KV 高度相似，本文件用一个适配器
// 把 Blob 包成业务代码期望的 KV 接口（get(key,'json') / put / delete / list({prefix})），
// 因此上方所有业务函数无需任何改动。
//
// 注意：本文件部署在 Edge Functions（edge-functions/ 目录），Blob 是边缘运行时
// 原生内置存储，@edgeone/pages-blob 由边缘运行时直接提供并自动注入部署凭证；
// 不要放到 cloud-functions/（云端 Node 运行时没有 Blob 凭证，getStore 会报错）。

import { getStore } from '@edgeone/pages-blob';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const STORE_NAME = 'travel';

function uid(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function genCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

// 把 Blob 存储适配成业务代码期望的 KV 接口。
// store: Blob 实例（来自 getStore），需支持 get/getJSON/set/delete/list。
function makeKVAdapter(store) {
  return {
    // 与 KV 一致：get(key,'json') 返回解析后的对象或 null；get(key) 返回原始字符串或 null
    async get(key, type) {
      if (type === 'json') {
        const v = await store.get(key, { type: 'json' });
        return v == null ? null : v;
      }
      const v = await store.get(key);
      return v == null ? null : v;
    },
    // 业务里 put 的值始终是字符串（JSON 字符串或原始 id），Blob set 存为文本
    async put(key, value) {
      await store.set(key, value);
    },
    async delete(key) {
      await store.delete(key);
    },
    // Blob list 自动聚合分页，直接返回全部 key
    async list({ prefix }) {
      const { blobs } = await store.list({ prefix, consistency: 'strong' });
      const keys = (blobs || []).map((b) => ({ key: b.key }));
      return { keys, cursor: null, complete: true };
    },
  };
}

async function getJSON(kv, key) {
  const v = await kv.get(key, 'json');
  return v == null ? null : v;
}

async function putJSON(kv, key, obj) {
  await kv.put(key, JSON.stringify(obj));
}

// 遍历某前缀下的所有 key
async function listKeys(kv, prefix) {
  const keys = [];
  let cursor;
  let res;
  do {
    res = await kv.list({ prefix, cursor });
    if (res && res.keys) for (const k of res.keys) keys.push(k.key);
    cursor = res ? res.cursor : null;
  } while (res && !res.complete);
  return keys;
}

async function deleteByPrefix(kv, prefix) {
  const keys = await listKeys(kv, prefix);
  for (const k of keys) await kv.delete(k);
}

// ---------- 行程 ----------
async function createTrip(kv, name) {
  if (!name || !name.trim()) throw new Error('行程名称不能为空');
  let code = genCode();
  // 避免邀请码碰撞
  while (await kv.get('code:' + code)) code = genCode();
  const id = uid('T');
  const trip = { id, name: name.trim(), created_at: new Date().toISOString(), code };
  await putJSON(kv, 'trip:' + id, trip);
  await kv.put('code:' + code, id);
  return trip;
}

async function listTrips(kv) {
  const keys = await listKeys(kv, 'trip:');
  const trips = [];
  for (const k of keys) {
    const t = await getJSON(kv, k);
    if (t) trips.push(t);
  }
  trips.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return trips;
}

async function getTrip(kv, id) {
  return getJSON(kv, 'trip:' + id);
}

async function getTripByCode(kv, code) {
  const id = await kv.get('code:' + String(code).toUpperCase());
  if (!id) return null;
  return getJSON(kv, 'trip:' + id);
}

async function deleteTrip(kv, id) {
  const trip = await getTrip(kv, id);
  if (!trip) throw new Error('行程不存在');
  await deleteByPrefix(kv, 'mem:' + id + ':');
  await deleteByPrefix(kv, 'exp:' + id + ':');
  await deleteByPrefix(kv, 'shr:' + id + ':');
  if (trip.code) await kv.delete('code:' + trip.code);
  await kv.delete('trip:' + id);
  return true;
}

// ---------- 成员 ----------
async function addMember(kv, tripId, name, created_by) {
  const trip = await getTrip(kv, tripId);
  if (!trip) throw new Error('行程不存在');
  if (!name || !name.trim()) throw new Error('姓名不能为空');
  const id = uid('M');
  const member = { id, trip_id: tripId, name: name.trim(), created_by: created_by || '' };
  await putJSON(kv, 'mem:' + tripId + ':' + id, member);
  return member;
}

async function listMembers(kv, tripId) {
  const keys = await listKeys(kv, 'mem:' + tripId + ':');
  const members = [];
  for (const k of keys) {
    const m = await getJSON(kv, k);
    if (m) members.push(m);
  }
  return members;
}

async function deleteMember(kv, tripId, memberId) {
  // 不允许删除“作为付款人且仍有支出”的成员
  const keys = await listKeys(kv, 'exp:' + tripId + ':');
  for (const k of keys) {
    const e = await getJSON(kv, k);
    if (e && e.payer_id === memberId) throw new Error('该成员已有支出记录，无法删除（请先删除其支出）');
  }
  await deleteByPrefix(kv, 'shr:' + tripId + ':'); // 该成员作为分摊人的记录也一并清除（极少，简单处理）
  await kv.delete('mem:' + tripId + ':' + memberId);
  return true;
}

// ---------- 支出 ----------
async function addExpense(kv, tripId, data) {
  const trip = await getTrip(kv, tripId);
  if (!trip) throw new Error('行程不存在');
  const { payer_id, amount, pay_method, note, paid_at, sharer_ids } = data;
  const payer = await getJSON(kv, 'mem:' + tripId + ':' + payer_id);
  if (!payer) throw new Error('付款人不存在');
  const amt = Number(amount);
  if (!isFinite(amt) || amt <= 0) throw new Error('金额必须为正数');
  const sharers = Array.isArray(sharer_ids) ? sharer_ids : [];
  if (sharers.length === 0) throw new Error('请至少选择一名分摊人员');
  // 校验分摊人都是本行程成员
  const members = await listMembers(kv, tripId);
  const memberIds = new Set(members.map((m) => m.id));
  for (const s of sharers) if (!memberIds.has(s)) throw new Error('分摊人不属于本行程');

  const id = uid('E');
  const expense = {
    id,
    trip_id: tripId,
    payer_id,
    amount: amt,
    pay_method: pay_method || '其他',
    note: note || '',
    paid_at: paid_at || new Date().toISOString(),
  };
  await putJSON(kv, 'exp:' + tripId + ':' + id, expense);
  for (const s of sharers) await kv.put('shr:' + tripId + ':' + id + ':' + s, '1');
  return expense;
}

async function listExpenses(kv, tripId) {
  const keys = await listKeys(kv, 'exp:' + tripId + ':');
  const expenses = [];
  for (const k of keys) {
    const e = await getJSON(kv, k);
    if (e) expenses.push(e);
  }
  expenses.sort((a, b) => (a.paid_at < b.paid_at ? -1 : 1));
  return expenses;
}

async function getSharers(kv, tripId, expenseId) {
  const keys = await listKeys(kv, 'shr:' + tripId + ':' + expenseId + ':');
  return keys.map((k) => k.slice(k.lastIndexOf(':') + 1));
}

async function deleteExpense(kv, tripId, expenseId) {
  await deleteByPrefix(kv, 'shr:' + tripId + ':' + expenseId + ':');
  await kv.delete('exp:' + tripId + ':' + expenseId);
  return true;
}

// ---------- 行程详情 ----------
async function getTripDetail(kv, id) {
  const trip = await getTrip(kv, id);
  if (!trip) return null;
  const members = await listMembers(kv, id);
  const expenses = await listExpenses(kv, id);
  for (const e of expenses) e.sharer_ids = await getSharers(kv, id, e.id);
  return { trip, members, expenses };
}

// ---------- 结算 ----------
function settle(detail) {
  const { members, expenses } = detail;
  const paid = {};
  const share = {};
  for (const m of members) {
    paid[m.id] = 0;
    share[m.id] = 0;
  }
  for (const e of expenses) {
    const amt = Number(e.amount) || 0;
    const shr = Array.isArray(e.sharer_ids) ? e.sharer_ids : [];
    if (shr.length > 0) {
      const per = amt / shr.length;
      for (const s of shr) if (s in share) share[s] += per;
    }
    if (e.payer_id in paid) paid[e.payer_id] += amt;
  }

  const nameOf = {};
  for (const m of members) nameOf[m.id] = m.name;

  const summary = members.map((m) => {
    const p = paid[m.id] || 0;
    const s = share[m.id] || 0;
    const net = p - s;
    return {
      id: m.id,
      name: m.name,
      paid: round2(p),
      share: round2(s),
      net: round2(net),
      role: net > 0.005 ? '应收' : net < -0.005 ? '应付' : '平账',
    };
  });

  // 贪心算法生成最小转账清单
  const creditors = [];
  const debtors = [];
  for (const x of summary) {
    if (x.net > 0.005) creditors.push({ id: x.id, name: x.name, amount: x.net });
    else if (x.net < -0.005) debtors.push({ id: x.id, name: x.name, amount: -x.net });
  }
  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);
  const transactions = [];
  let i = 0;
  let j = 0;
  while (i < creditors.length && j < debtors.length) {
    const c = creditors[i];
    const d = debtors[j];
    const pay = Math.min(c.amount, d.amount);
    transactions.push({ fromId: d.id, fromName: d.name, toId: c.id, toName: c.name, amount: round2(pay) });
    c.amount -= pay;
    d.amount -= pay;
    if (c.amount <= 0.005) i++;
    if (d.amount <= 0.005) j++;
  }

  return { summary, transactions };
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// 解析存储实例：在 Edge Functions 边缘运行时中，@edgeone/pages-blob 由运行时原生
// 提供并自动注入部署凭证，getStore 直接拿到 Blob 命名空间（首次调用自动创建，
// 无需控制台开通），再用适配器包成业务代码期望的 KV 接口。
async function resolveKV() {
  try {
    const store = getStore({ name: STORE_NAME });
    return makeKVAdapter(store);
  } catch (e) {
    console.error('resolveKV failed:', e && e.message);
    return null;
  }
}

export {
  uid,
  makeKVAdapter,
  createTrip,
  listTrips,
  getTrip,
  getTripByCode,
  deleteTrip,
  addMember,
  listMembers,
  deleteMember,
  addExpense,
  listExpenses,
  getSharers,
  deleteExpense,
  getTripDetail,
  settle,
  resolveKV,
};
