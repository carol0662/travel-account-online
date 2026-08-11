import { createTrip, listTrips, resolveKV } from '../_db.js';
import { json, fail, body } from '../_resp.js';

export async function onRequestGet(context) {
  const kv = await resolveKV(context);
  if (!kv) return fail('存储未初始化（Blob 存储创建失败，请稍后重试）', 500);
  try {
    const data = await listTrips(kv);
    return json(data);
  } catch (e) {
    return fail(e.message);
  }
}

export async function onRequestPost(context) {
  const kv = await resolveKV(context);
  if (!kv) return fail('存储未初始化（Blob 存储创建失败，请稍后重试）', 500);
  try {
    const b = await body(context.request);
    const trip = await createTrip(kv, b.name);
    return json(trip, 201);
  } catch (e) {
    return fail(e.message);
  }
}
