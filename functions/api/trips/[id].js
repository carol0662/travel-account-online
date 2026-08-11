import { getTrip, getTripDetail, deleteTrip, resolveKV } from '../_db.js';
import { json, fail } from '../_resp.js';

export async function onRequestGet(context) {
  const kv = await resolveKV(context);
  if (!kv) return fail('存储未初始化（Blob 存储创建失败，请稍后重试）', 500);
  try {
    const id = context.params.id;
    const detail = await getTripDetail(kv, id);
    if (!detail) return fail('行程不存在', 404);
    return json(detail);
  } catch (e) {
    return fail(e.message);
  }
}

export async function onRequestDelete(context) {
  const kv = await resolveKV(context);
  if (!kv) return fail('存储未初始化（Blob 存储创建失败，请稍后重试）', 500);
  try {
    const id = context.params.id;
    await deleteTrip(kv, id);
    return json({ deleted: true });
  } catch (e) {
    return fail(e.message);
  }
}
