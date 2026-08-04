import { addMember, listMembers, resolveKV } from '../_db.js';
import { json, fail, body } from '../_resp.js';

export async function onRequestGet(context) {
  const kv = resolveKV(context);
  if (!kv) return fail('KV 未绑定', 500);
  try {
    const members = await listMembers(kv, context.params.id);
    return json(members);
  } catch (e) {
    return fail(e.message);
  }
}

export async function onRequestPost(context) {
  const kv = resolveKV(context);
  if (!kv) return fail('KV 未绑定', 500);
  try {
    const b = await body(context.request);
    const member = await addMember(kv, context.params.id, b.name, b.created_by);
    return json(member, 201);
  } catch (e) {
    return fail(e.message);
  }
}
