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
    // force（手动重载）插队并允许略超并发
    if (force) {
      return new Promise((resolve) => {
        mediaDownloadInFlight++;
        void work()
          .then(resolve)
          .catch(() => resolve(""))
          .finally(() => {
            mediaDownloadInFlight = Math.max(0, mediaDownloadInFlight - 1);
            pumpQueue();
          });
      });
    }
    return new Promise((resolve) => {
      waitQueue.push({ run: work, resolve });
      // 队列过长时丢掉最旧的非 force 任务，避免内存爆
      if (waitQueue.length > 80) {
        const dropped = waitQueue.shift();
        dropped?.resolve("");
      }
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
