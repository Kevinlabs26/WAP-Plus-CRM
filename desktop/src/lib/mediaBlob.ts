/** Read media URLs without relying on WebView2 fetching a data: URL. */
export function dataUrlToBlob(
  dataUrl: string,
  fallbackMimeType = "application/octet-stream",
): Blob {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.toLowerCase().startsWith("data:") || comma < 0) {
    throw new Error("语音数据格式无效");
  }

  const header = dataUrl.slice(5, comma);
  const payload = dataUrl.slice(comma + 1);
  const mimeType = header.split(";", 1)[0] || fallbackMimeType;
  if (/;base64(?:;|$)/i.test(header)) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeType });
  }

  return new Blob([new TextEncoder().encode(decodeURIComponent(payload))], {
    type: mimeType,
  });
}

export async function mediaUrlToBlob(
  mediaUrl: string,
  fallbackMimeType = "application/octet-stream",
): Promise<Blob> {
  if (mediaUrl.toLowerCase().startsWith("data:")) {
    return dataUrlToBlob(mediaUrl, fallbackMimeType);
  }
  const response = await fetch(mediaUrl);
  if (!response.ok) throw new Error(`无法读取语音文件：HTTP ${response.status}`);
  return response.blob();
}
