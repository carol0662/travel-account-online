import { getTripByCode, resolveKV } from '../_db.js';
import { json, fail } from '../_resp.js';

export async function onRequestGet(context) {
  const kv = resolveKV(context);
  if (!kv) return fail('KV 未绑定', 500);
  try {
    const code = context.params.code;
    const trip = await getTripByCode(kv, code);
    if (!trip) return fail('邀请码无效', 404);
    return json(trip);
  } catch (e) {
    return fail(e.message);
  }
}
