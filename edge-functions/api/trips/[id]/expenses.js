import { addExpense, listExpenses, resolveKV } from '../../_db.js';
import { json, fail, body } from '../../_resp.js';

export async function onRequestGet(context) {
  const kv = await resolveKV();
  if (!kv) return fail('存储未初始化（Blob 存储创建失败，请稍后重试）', 500);
  try {
    const expenses = await listExpenses(kv, context.params.id);
    return json(expenses);
  } catch (e) {
    return fail(e.message);
  }
}

export async function onRequestPost(context) {
  const kv = await resolveKV();
  if (!kv) return fail('存储未初始化（Blob 存储创建失败，请稍后重试）', 500);
  try {
    const b = await body(context.request);
    const expense = await addExpense(kv, context.params.id, b);
    return json(expense, 201);
  } catch (e) {
    return fail(e.message);
  }
}
