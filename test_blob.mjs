// 本地验证：用内存模拟 Blob 存储，跑通数据层适配器 + 业务逻辑
// 运行：node test_blob.mjs
import {
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
} from './functions/_db.js';

// 极简内存版 Blob 存储，模拟 @edgeone/pages-blob 的真实行为
function makeMockBlob() {
  const data = new Map(); // key -> string
  return {
    async set(key, value) {
      data.set(key, String(value));
    },
    async get(key, opts) {
      if (!data.has(key)) return null;
      const raw = data.get(key);
      if (opts && opts.type === 'json') {
        try {
          return JSON.parse(raw);
        } catch (e) {
          return null;
        }
      }
      return raw;
    },
    async delete(key) {
      data.delete(key);
    },
    async list({ prefix }) {
      const blobs = [];
      for (const k of data.keys()) {
        if (!prefix || k.startsWith(prefix)) blobs.push({ key: k });
      }
      return { blobs };
    },
  };
}

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log('  ✓ ' + msg);
  } else {
    failed++;
    console.error('  ✗ ' + msg);
  }
}

async function main() {
  const kv = makeKVAdapter(makeMockBlob());

  console.log('1) 创建行程 + 邀请码');
  const trip = await createTrip(kv, '东京之旅');
  assert(trip && trip.id && trip.code && trip.code.length === 6, '行程创建成功，含 6 位邀请码: ' + trip.code);
  const byCode = await getTripByCode(kv, trip.code);
  assert(byCode && byCode.id === trip.id, '用邀请码能查回同一行程');
  const byCodeLower = await getTripByCode(kv, trip.code.toLowerCase());
  assert(byCodeLower && byCodeLower.id === trip.id, '邀请码大小写不敏感');

  console.log('2) 添加成员');
  const zhang = await addMember(kv, trip.id, '张三', 'U1');
  const li = await addMember(kv, trip.id, '李四', 'U2');
  const wang = await addMember(kv, trip.id, '王五', 'U3');
  assert(zhang.id && li.id && wang.id, '三人成员创建成功');
  const members = await listMembers(kv, trip.id);
  assert(members.length === 3, '成员列表为 3 人');

  console.log('3) 记录支出');
  // 张三付300，李四王五平摊
  await addExpense(kv, trip.id, { payer_id: zhang.id, amount: 300, pay_method: '信用卡', sharer_ids: [li.id, wang.id], note: '酒店' });
  // 李四付150，三人平摊
  await addExpense(kv, trip.id, { payer_id: li.id, amount: 150, pay_method: '微信', sharer_ids: [zhang.id, li.id, wang.id], note: '晚餐' });
  // 王五付90，三人平摊
  await addExpense(kv, trip.id, { payer_id: wang.id, amount: 90, pay_method: '支付宝', sharer_ids: [zhang.id, li.id, wang.id], note: '门票' });

  const expenses = await listExpenses(kv, trip.id);
  assert(expenses.length === 3, '支出列表为 3 笔');
  const shr = await getSharers(kv, trip.id, expenses[0].id);
  assert(shr.length === 2 && shr.includes(li.id) && shr.includes(wang.id), '首笔支出分摊人为李四、王五');

  console.log('4) 行程详情 + 结算（已知结果：张三应收220 = 李四80 + 王五140）');
  const detail = await getTripDetail(kv, trip.id);
  assert(detail && detail.members.length === 3 && detail.expenses.length === 3, '详情聚合正确');
  const result = settle(detail);
  const zs = result.summary.find((s) => s.id === zhang.id);
  const ls = result.summary.find((s) => s.id === li.id);
  const ws = result.summary.find((s) => s.id === wang.id);
  assert(zs.net === 220, '张三净应收 220（实际 ' + zs.net + '）');
  assert(ls.net === -80, '李四净应付 -80（实际 ' + ls.net + '）');
  assert(ws.net === -140, '王五净应付 -140（实际 ' + ws.net + '）');
  assert(result.transactions.length === 2, '转账清单 2 笔');
  const t1 = result.transactions.find((t) => t.toId === zhang.id && t.fromId === li.id);
  const t2 = result.transactions.find((t) => t.toId === zhang.id && t.fromId === wang.id);
  assert(t1 && t1.amount === 80, '李四→张三 80');
  assert(t2 && t2.amount === 140, '王五→张三 140');

  console.log('5) 删除保护 + 级联删除');
  let guardErr = null;
  try {
    await deleteMember(kv, trip.id, zhang.id); // 张三有支出，应被拒绝
  } catch (e) {
    guardErr = e;
  }
  assert(guardErr && /支出/.test(guardErr.message), '有支出的成员无法被删除（保护生效）');

  await deleteExpense(kv, trip.id, expenses[0].id);
  const expenses2 = await listExpenses(kv, trip.id);
  assert(expenses2.length === 2, '删除一笔支出后剩 2 笔');
  // 张三已无支出，现在可删
  await deleteMember(kv, trip.id, zhang.id);
  const members2 = await listMembers(kv, trip.id);
  assert(members2.length === 2, '删除成员后剩 2 人');

  await deleteTrip(kv, trip.id);
  const after = await getTrip(kv, trip.id);
  assert(after === null, '删除行程后查不到');
  const byCodeAfter = await getTripByCode(kv, trip.code);
  assert(byCodeAfter === null, '删除行程后邀请码也失效');
  const membersAfter = await listMembers(kv, trip.id);
  assert(membersAfter.length === 0, '删除行程级联清空成员');

  console.log('6) 列表与异常');
  const t2trip = await createTrip(kv, ' 厦门之旅 ');
  assert(t2trip.name === '厦门之旅', '名称自动 trim');
  let emptyErr = null;
  try {
    await createTrip(kv, '   ');
  } catch (e) {
    emptyErr = e;
  }
  assert(emptyErr, '空行程名被拒绝');
  const all = await listTrips(kv);
  assert(all.length === 1 && all[0].id === t2trip.id, '行程列表正确');

  console.log('\n结果：通过 ' + passed + '，失败 ' + failed);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('测试异常：', e);
  process.exit(1);
});
