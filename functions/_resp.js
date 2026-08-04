// 统一的 JSON 响应辅助
function json(data, status = 200) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
  });
}

function fail(msg, status = 400) {
  return new Response(JSON.stringify({ ok: false, msg }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
  });
}

// 解析请求体 JSON（容错）
async function body(request) {
  try {
    return await request.json();
  } catch (e) {
    return {};
  }
}

export { json, fail, body };
