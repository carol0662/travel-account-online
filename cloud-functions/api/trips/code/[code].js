import { getTripByCode, resolveKV } from '../../_db.js';
import { json, fail } from '../../_resp.js';

export async function onRequestGet(context) {
  const kv = await resolveKV();
  if (!kv) return fail('存储未初始化（Blob 存储创建失败，请稍后重试）', 500);
  try {
    const code = context.params.code;
    const trip = await getTripByCode(kv, code);
    if (!trip) return fail('邀请码无效', 404);
    return json(trip);
  } catch (e) {
    return fail(e.message);
  }
}
