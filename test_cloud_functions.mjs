// 验证 edge-functions 模块可以正常 import（不依赖 EdgeOne 运行时）
import { createTrip, listTrips, settle, resolveKV, uid } from './edge-functions/_db.js';
import { json, fail, body } from './edge-functions/_resp.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error(`FAIL: ${msg}`); }
}

// 测试 _resp.js
const r = json({ hello: 'world' });
assert(r instanceof Response, 'json returns Response');
assert(r.status === 200, 'json status 200');
const f = fail('error', 401);
assert(f instanceof Response, 'fail returns Response');
assert(f.status === 401, 'fail status 401');

// 测试 _db.js 工具函数
assert(typeof uid === 'function', 'uid is function');
const id = uid('test:');
assert(id.startsWith('test:'), 'uid prefix');

// 测试 resolveKV（本地没有 Blob SDK，应返回 null）
const kv = await resolveKV();
assert(kv === null, 'resolveKV returns null locally (no Blob SDK)');

// 测试结算算法（纯函数，不需要存储）
const mockDetail = {
  trip: { id: 't1', name: '测试行程' },
  members: [
    { id: 'm1', name: '张三' },
    { id: 'm2', name: '李四' },
    { id: 'm3', name: '王五' },
  ],
  expenses: [
    { id: 'e1', payer_id: 'm1', payer_name: '张三', amount: 300, sharer_ids: ['m2', 'm3'] },
    { id: 'e2', payer_id: 'm2', payer_name: '李四', amount: 150, sharer_ids: ['m1', 'm2', 'm3'] },
    { id: 'e3', payer_id: 'm3', payer_name: '王五', amount: 90, sharer_ids: ['m1', 'm2', 'm3'] },
  ],
};
const result = settle(mockDetail);
assert(result.transactions.length === 2, `settle returns 2 transactions (got ${result.transactions?.length ?? 'undefined'})`);
assert(result.transactions[0].fromName === '王五', 'tx 1 from 王五');
assert(result.transactions[0].toName === '张三', 'tx 1 to 张三');
assert(result.transactions[0].amount === 140, `tx 1 amount 140 (got ${result.transactions[0].amount})`);
assert(result.transactions[1].fromName === '李四', 'tx 2 from 李四');
assert(result.transactions[1].toName === '张三', 'tx 2 to 张三');
assert(result.transactions[1].amount === 80, `tx 2 amount 80 (got ${result.transactions[1].amount})`);

console.log(`\n✅ ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
