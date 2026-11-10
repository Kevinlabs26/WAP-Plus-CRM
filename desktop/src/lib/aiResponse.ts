const MAX_RESPONSE_BYTES = 1_000_000;
export const AI_OUTPUT_TRUNCATED = "AI 回复达到输出上限，内容未完整生成，请重新生成";

/** Bound decoded network bytes; Content-Length alone may describe compressed data or be false. */
export async function readAiJson(response: Response, observe?: (data: unknown) => void, maxBytes = MAX_RESPONSE_BYTES): Promise<unknown> {
  const tooLarge = () => new Error(`AI / 翻译服务响应超过 ${Math.round(maxBytes / 1_000_000)} MB 上限`);
  if (Number(response.headers.get("content-length")) > maxBytes) {
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
      if (bytes > maxBytes) throw tooLarge();
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const data = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  const result=JSON.parse(new TextDecoder().decode(data));
  observe?.(result);
  return result;
}
