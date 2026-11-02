const MAX_RESPONSE_BYTES = 1_000_000;

/** Bound decoded network bytes; Content-Length alone may describe compressed data or be false. */
export async function readAiJson(response: Response): Promise<unknown> {
  const tooLarge = () => new Error("AI / 翻译服务响应超过 1 MB 上限");
  if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw tooLarge();
  }
  if (!response.body) throw new Error("AI / 翻译服务返回空响应");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw tooLarge();
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const data = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(data));
}
