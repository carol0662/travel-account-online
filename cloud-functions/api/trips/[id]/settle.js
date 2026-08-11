import { getTripDetail, settle, resolveKV } from '../../_db.js';
import { json, fail } from '../../_resp.js';

export async function onRequestGet(context) {
  const kv = await resolveKV();
  if (!kv) return fail('存储未初始化（Blob 存储创建失败，请稍后重试）', 500);
  try {
    const detail = await getTripDetail(kv, context.params.id);
    if (!detail) return fail('行程不存在', 404);
    const result = settle(detail);
    return json(result);
  } catch (e) {
    return fail(e.message);
  }
}
