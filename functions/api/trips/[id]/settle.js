import { getTripDetail, settle, resolveKV } from '../_db.js';
import { json, fail } from '../_resp.js';

export async function onRequestGet(context) {
  const kv = resolveKV(context);
  if (!kv) return fail('KV 未绑定', 500);
  try {
    const detail = await getTripDetail(kv, context.params.id);
    if (!detail) return fail('行程不存在', 404);
    const result = settle(detail);
    return json(result);
  } catch (e) {
    return fail(e.message);
  }
}
