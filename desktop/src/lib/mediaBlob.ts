// 音频默认使用 bridge 的 14 MB 上限，其它媒体沿用发送端的文件上限。
const MAX_AUDIO_BYTES = 14_000_000;
const audioTooLarge = () => new Error("语音文件超过 14 MB 上限");

/** Read media URLs without relying on WebView2 fetching a data: URL. */
export function dataUrlToBlob(
  dataUrl: string,
  fallbackMimeType = "application/octet-stream",
  maxBytes = MAX_AUDIO_BYTES,
): Blob {
  const tooLarge = () => maxBytes === MAX_AUDIO_BYTES ? audioTooLarge() : new Error("媒体文件超过大小上限");
  const comma = dataUrl.indexOf(",");
  if (dataUrl.slice(0, 5).toLowerCase() !== "data:" || comma < 0) {
    throw new Error("媒体数据格式无效");
  }

  const header = dataUrl.slice(5, comma);
  const payload = dataUrl.slice(comma + 1);
  const mimeType = header.split(";", 1)[0] || fallbackMimeType;
  if (/;base64(?:;|$)/i.test(header)) {
    if (payload.length > 4 * Math.ceil(maxBytes / 3)) throw tooLarge();
    const binary = atob(payload);
    if (binary.length > maxBytes) throw tooLarge();
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeType });
  }

  // A percent-encoded byte uses at most three characters.
  if (payload.length > maxBytes * 3) throw tooLarge();
  const bytes = new TextEncoder().encode(decodeURIComponent(payload));
  if (bytes.byteLength > maxBytes) throw tooLarge();
  return new Blob([bytes], {
    type: mimeType,
  });
}

export async function mediaUrlToBlob(
  mediaUrl: string,
  fallbackMimeType = "application/octet-stream",
): Promise<Blob> {
  if (mediaUrl.slice(0, 5).toLowerCase() === "data:") {
    return dataUrlToBlob(mediaUrl, fallbackMimeType);
  }
  const response = await fetch(mediaUrl, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`无法读取语音文件：HTTP ${response.status}`);
  if (Number(response.headers.get("content-length")) > MAX_AUDIO_BYTES) {
    await response.body?.cancel();
    throw audioTooLarge();
  }
  if (!response.body) throw new Error("语音文件没有响应数据流");
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_AUDIO_BYTES) throw audioTooLarge();
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return new Blob(chunks, { type: response.headers.get("content-type") || fallbackMimeType });
}
