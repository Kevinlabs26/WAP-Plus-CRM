/** 浏览器从 localhost:3000 打 127.0.0.1:port 时会预检自定义头 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type, X-Wap-Token, X-Wap-Account-Id, Authorization",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Max-Age": "86400",
};

export function writeCors(res) {
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    res.setHeader(k, v);
  }
}

export function json(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...CORS_HEADERS,
  });
  res.end(JSON.stringify(value));
}

export async function requestBody(req) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    // 前端允许 14MB 音频（base64 约 18.7MB），限制需放得下
    if (text.length > 40_000_000) throw new Error("request too large");
  }
  return text ? JSON.parse(text) : {};
}
