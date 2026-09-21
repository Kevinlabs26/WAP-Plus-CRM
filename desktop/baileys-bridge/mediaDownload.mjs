import { downloadMediaMessage } from "baileys";

/**
 * 带并发限制 + 排队的媒体下载 → data URL。
 * 旧实现满并发直接丢弃，群图/视频/贴纸会大量「预览未就绪」。
 * deps: { getConnection, getSocket, logger }
 */
export function createMediaDownloader(deps) {
  let mediaDownloadInFlight = 0;
  const MEDIA_DOWNLOAD_MAX = 3;
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
        const buf = await downloadMediaMessage(
          waMessage,
          "buffer",
          {},
          {
            logger: deps.logger,
            reuploadRequest: socket?.updateMediaMessage,
          }
        );
        if (!buf || !Buffer.isBuffer(buf)) return "";
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
        if (buf.length > max) {
          deps.logger?.debug?.(
            { len: buf.length, max, mediaType },
            "media too large skipped"
          );
          return "";
        }
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
