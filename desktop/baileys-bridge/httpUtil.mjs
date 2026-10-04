/** Only the local desktop UI and development UI may use this API. */
const ALLOWED_ORIGINS = new Set([
  "http://localhost:3000", "http://127.0.0.1:3000",
  "tauri://localhost", "http://tauri.localhost", "https://tauri.localhost",
]);
const CORS_HEADERS = {
  "Access-Control-Allow-Headers":
    "Content-Type, X-Wap-Token, X-Wap-Account-Id, Authorization",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Max-Age": "86400",
};

export function writeCors(req, res) {
  const origin = req.headers.origin;
  res.setHeader("Vary", "Origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) return false;
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    res.setHeader(k, v);
  }
  return true;
}

export function json(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
}

export async function requestBody(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    // 前端允许 14MB 音频（base64 约 18.7MB），限制需放得下
    if (bytes > 40_000_000) throw Object.assign(new Error("request too large"), { status: 413 });
    chunks.push(buffer);
  }
  try {
    const text = Buffer.concat(chunks).toString("utf8");
    const value = text ? JSON.parse(text) : {};
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw Object.assign(new Error("invalid JSON object"), { status: 400 });
  }
}

export async function readBoundedStream(stream, maxBytes) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of stream) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw Object.assign(new Error("media too large"), { status: 413 });
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
