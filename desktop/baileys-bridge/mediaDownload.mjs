import { downloadMediaMessage, extractMessageContent, getContentType } from "baileys";
import { readBoundedStream } from "./httpUtil.mjs";
import { downloadRemoteMedia, validateRemoteMediaUrl } from "./remoteMedia.mjs";

export async function downloadSafeMediaMessage(message, maxBytes) {
  const content = extractMessageContent(message.message);
  const type = getContentType(content);
  const media = content?.[type];
  if (!media || typeof media !== "object") throw new Error("invalid media message");
  const path = media.directPath || media.thumbnailDirectPath;
  const host = media.url ? validateRemoteMediaUrl(media.url).host : "mmg.whatsapp.net";
  if (!/(?:^|\.)(?:whatsapp\.net|whatsapp\.com|fbcdn\.net)$/.test(host)) {
    throw new Error("media host is not a WhatsApp CDN");
  }
  if (path && (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//"))) {
    throw new Error("invalid media direct path");
  }
  const remote = path ? `https://${host}${path}` : media.url;
  const { buffer } = await downloadRemoteMedia(remote, maxBytes + 16_384);
  // The SDK only decrypts bounded in-memory ciphertext. It never fetches
  // attacker-controlled URLs (including a newly reuploaded URL) itself.
  return downloadMediaMessage({
    ...message,
    message: { [type]: { ...media, directPath: undefined, thumbnailDirectPath: undefined,
      url: `data:application/octet-stream;base64,${buffer.toString("base64")}` } },
  }, "stream", {});
}

/**
 * 带并发限制 + 排队的媒体下载 → data URL。
 * 旧实现满并发直接丢弃，群图/视频/贴纸会大量「预览未就绪」。
 * deps: { getConnection, getSocket, logger }
 */
export function createMediaDownloader(deps) {
  let mediaDownloadInFlight = 0;
  const MEDIA_DOWNLOAD_MAX = 3;
  const MEDIA_DOWNLOAD_QUEUE_MAX = 64;
  /** @type {Array<{ run: () => Promise<any>, resolve: (v: any) => void }>} */
  const waitQueue = [];

  function pumpQueue() {
    while (
      mediaDownloadInFlight < MEDIA_DOWNLOAD_MAX &&
      waitQueue.length > 0
    ) {
      const job = waitQueue.shift();
      if (!job) break;
      mediaDownloadInFlight++;
      void job
        .run()
        .then((v) => job.resolve(v))
        .catch(() => job.resolve(""))
        .finally(() => {
          mediaDownloadInFlight = Math.max(0, mediaDownloadInFlight - 1);
          pumpQueue();
        });
    }
  }

  /**
   * @param {() => Promise<string>} work
   * @param {{ force?: boolean }} opts
   */
  function schedule(work, opts = {}) {
    if (waitQueue.length >= MEDIA_DOWNLOAD_QUEUE_MAX) {
      return Promise.reject(Object.assign(new Error("媒体下载繁忙，请稍后重试"), { status: 503 }));
    }
    const force = Boolean(opts.force);
    return new Promise((resolve) => {
      // 手动重试优先，但仍然经过同一个并发队列，避免同时发起大量
      // 下载把连接/内存打满。队列中的任务不能静默丢弃，否则图片会
      // 永久停留在“重新尝试”状态。
      const job = { run: work, resolve };
      if (force) waitQueue.unshift(job);
      else waitQueue.push(job);
      pumpQueue();
    });
  }

  async function mediaToDataUrl(waMessage, mediaType, mimetype, opts = {}) {
    if (!waMessage || !mediaType) return "";
    if (deps.getConnection() !== "connected") return "";
    const force = Boolean(opts.force);

    return schedule(async () => {
      try {
        const socket = deps.getSocket?.();
        const max = force
          ? mediaType === "document"
            ? 16_000_000
            : mediaType === "video" || mediaType === "gif"
              ? 12_000_000
              : 6_000_000
          : mediaType === "image" || mediaType === "sticker"
            ? 4_000_000
            : mediaType === "video" || mediaType === "gif"
              ? 6_000_000
              : 3_000_000;
        let stream;
        try { stream = await downloadSafeMediaMessage(waMessage, max); }
        catch (error) {
          if (![404, 410].includes(error.status) || !socket?.updateMediaMessage) throw error;
          stream = await downloadSafeMediaMessage(await socket.updateMediaMessage(waMessage), max);
        }
        const buf = await readBoundedStream(stream, max);
        if (!buf.length) return "";
        const mime =
          (mimetype || "").split(";")[0] ||
          (mediaType === "image" || mediaType === "sticker"
            ? "image/jpeg"
            : mediaType === "audio"
              ? "audio/ogg"
              : mediaType === "video" || mediaType === "gif"
                ? "video/mp4"
                : "application/octet-stream");
        return `data:${mime};base64,${buf.toString("base64")}`;
      } catch (e) {
        deps.logger?.debug?.({ err: String(e) }, "media download failed");
        return "";
      }
    }, { force });
  }

  return { mediaToDataUrl };
}
