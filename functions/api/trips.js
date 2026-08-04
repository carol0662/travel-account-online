import { createTrip, listTrips, resolveKV } from '../_db.js';
import { json, fail, body } from '../_resp.js';

export async function onRequestGet(context) {
  const kv = resolveKV(context);
  if (!kv) return fail('KV 未绑定（请在 EdgeOne 项目中绑定命名空间，变量名 TRAVEL_KV）', 500);
  try {
    const data = await listTrips(kv);
    return json(data);
  } catch (e) {
    return fail(e.message);
  }
}

export async function onRequestPost(context) {
  const kv = resolveKV(context);
  if (!kv) return fail('KV 未绑定', 500);
  try {
    const b = await body(context.request);
    const trip = await createTrip(kv, b.name);
    return json(trip, 201);
  } catch (e) {
    return fail(e.message);
  }
}
