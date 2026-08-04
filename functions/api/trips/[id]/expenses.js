import { addExpense, listExpenses, resolveKV } from '../_db.js';
import { json, fail, body } from '../_resp.js';

export async function onRequestGet(context) {
  const kv = resolveKV(context);
  if (!kv) return fail('KV 未绑定', 500);
  try {
    const expenses = await listExpenses(kv, context.params.id);
    return json(expenses);
  } catch (e) {
    return fail(e.message);
  }
}

export async function onRequestPost(context) {
  const kv = resolveKV(context);
  if (!kv) return fail('KV 未绑定', 500);
  try {
    const b = await body(context.request);
    const expense = await addExpense(kv, context.params.id, b);
    return json(expense, 201);
  } catch (e) {
    return fail(e.message);
  }
}
