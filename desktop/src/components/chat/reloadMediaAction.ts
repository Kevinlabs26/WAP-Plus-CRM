import {
  baileysDownloadMedia,
  baileysSync,
} from "@/lib/baileys";
import { bridgeInvoke } from "@/lib/bridge";
import { cacheMediaUrl, readMediaCache } from "@/lib/mediaCache";
import type { AppState } from "@/store/appStore";
import type { Message } from "@/types/crm";
import {
  inferMediaType,
  QUIET_MEDIA_RETRY_DELAYS_MS,
  shouldRetryMediaAfterSync,
} from "./messageMediaUtils";
import { translateCurrent } from "@/i18n";

const QUIET_MEDIA_CONCURRENCY = 2;
let quietMediaActive = 0;
const quietMediaWaiters: Array<() => void> = [];

async function acquireQuietMediaSlot() {
  if (quietMediaActive >= QUIET_MEDIA_CONCURRENCY) {
    await new Promise<void>((resolve) => quietMediaWaiters.push(resolve));
  }
  quietMediaActive += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    quietMediaActive = Math.max(0, quietMediaActive - 1);
    quietMediaWaiters.shift()?.();
  };
}

type MessageKey = {
  id: string;
  remoteJid: string;
  fromMe?: boolean;
};

type ReloadMediaActionDeps = {
  message: Message;
  sourceMessage: Message;
  isBaileys: boolean;
  chatConnected: boolean;
  chatAccountId: string;
  activeContactName: string;
  mediaResyncAt: Map<string, number>;
  mediaInFlight: Set<string>;
  setMediaBusyId: (id: string | null) => void;
  resolveMessageKey: (message: Message) => MessageKey | null;
  updateMessageDelivery: AppState["updateMessageDelivery"];
  pushToast: AppState["pushToast"];
  /** 静默补拉（打开会话自动预取）：不 set mediaBusyId，避免 itemContent 全列表重渲染闪烁 */
  quiet?: boolean;
};

export async function reloadMedia({
  message,
  sourceMessage,
  isBaileys,
  chatConnected,
  chatAccountId,
  activeContactName,
  mediaResyncAt,
  mediaInFlight,
  setMediaBusyId,
  resolveMessageKey,
  updateMessageDelivery,
  pushToast,
  quiet,
}: ReloadMediaActionDeps) {
  if (quiet) pushToast = () => undefined;
  const mediaCacheId = sourceMessage.id;
  const cached = await readMediaCache(mediaCacheId);
  if (cached) {
    updateMessageDelivery(message.id, {
      mediaUrl: cached,
      mediaPending: false,
      mediaError: undefined,
    });
    return;
  }
  if (!isBaileys) {
    try {
      await bridgeInvoke("bridge_send_raw", {
        envelope: {
          id: `prepare-media-${mediaCacheId}-${Date.now()}`,
          type: "wa.prepare_media",
          ts: Date.now(),
          deviceId: sourceMessage.deviceId || chatAccountId,
          payload: {
            messageId: mediaCacheId,
            jid: sourceMessage.waKey?.remoteJid || "",
            phoneE164: sourceMessage.phoneE164 || "",
            displayName: activeContactName,
            body: sourceMessage.body,
            sentAt: Date.parse(sourceMessage.sentAt) || Date.now(),
          },
        },
      });
      pushToast(translateCurrent("runtime.prepareMediaPhone"), "info");
    } catch {
      pushToast(translateCurrent("runtime.phoneBridgeUnavailable"), "error");
    }
    return;
  }
  if (!chatConnected) {
    const error = translateCurrent("chat.connectFirst");
    updateMessageDelivery(message.id, { mediaError: error });
    pushToast(error, "error");
    return;
  }
  const key = resolveMessageKey(sourceMessage);
  if (!key?.id) {
    updateMessageDelivery(message.id, {
      mediaError: translateCurrent("runtime.mediaMissingProtocol"),
    });
    pushToast(translateCurrent("runtime.mediaMissingProtocol"), "error");
    return;
  }
  if (mediaInFlight.has(message.id)) return;
  mediaInFlight.add(message.id);
  updateMessageDelivery(message.id, { mediaError: undefined });
  if (!quiet) setMediaBusyId(message.id);
  const releaseQuietSlot = quiet
    ? await acquireQuietMediaSlot()
    : () => undefined;
  try {
    let res: Awaited<ReturnType<typeof baileysDownloadMedia>> | null = null;
    let lastDownloadError: unknown;
    const download = () =>
      baileysDownloadMedia(key, {
        mediaType: sourceMessage.mediaType || inferMediaType(sourceMessage) || undefined,
        mimetype: sourceMessage.mediaMime,
        accountId: chatAccountId,
      });
    try {
      res = await download();
    } catch (error) {
      lastDownloadError = error;
      // The bridge can temporarily lose the in-memory message after restart.
      // A 404 is recoverable by syncing once and retrying the media request.
      if (!quiet && !shouldRetryMediaAfterSync(error)) throw error;
    }
    if (!res?.mediaUrl) {
      const lastSync = mediaResyncAt.get(chatAccountId) || 0;
      if (Date.now() - lastSync > 30_000) {
        mediaResyncAt.set(chatAccountId, Date.now());
        try {
          await baileysSync(chatAccountId);
          res = await download();
        } catch (error) {
          lastDownloadError = error;
          /* 保留原始媒体错误提示 */
        }
      }
    }
    if (!res?.mediaUrl && quiet) {
      for (const delayMs of QUIET_MEDIA_RETRY_DELAYS_MS) {
        await new Promise((resolve) => window.setTimeout(resolve, delayMs));
        try {
          res = await download();
          if (res?.mediaUrl) break;
        } catch (error) {
          lastDownloadError = error;
        }
      }
    }
    if (!res?.mediaUrl) {
      const err =
        (res as { error?: string })?.error ||
        (lastDownloadError instanceof Error ? lastDownloadError.message : "") ||
        translateCurrent("runtime.mediaMissingOriginal");
      pushToast(
        (message.mediaType === "video" || inferMediaType(message) === "video"
          ? translateCurrent("runtime.videoLoadFailed", { error: err })
          : translateCurrent("runtime.mediaLoadFailed", { error: err })),
        "error"
      );
      updateMessageDelivery(message.id, {
        mediaError: String(err).slice(0, 240),
      });
      return;
    }
    updateMessageDelivery(message.id, {
      mediaUrl: res.mediaUrl,
      mediaType: res.mediaType || message.mediaType,
      mediaMime: res.mediaMime || message.mediaMime,
      mediaFileName: res.mediaFileName || message.mediaFileName,
      mediaThumbUrl:
        (res as { mediaThumbUrl?: string }).mediaThumbUrl || message.mediaThumbUrl,
      mediaPending: false,
      mediaError: undefined,
    });
    await cacheMediaUrl(mediaCacheId, res.mediaUrl);
    pushToast(
      message.mediaType === "video" || inferMediaType(message) === "video"
        ? translateCurrent("runtime.videoLoaded")
        : translateCurrent("runtime.mediaLoaded"),
      "success"
    );
  } catch (error) {
    const messageText = error instanceof Error ? error.message : translateCurrent("runtime.mediaLoadFailed", { error: "" }).replace(/:\s*$/, "");
    updateMessageDelivery(message.id, {
      mediaError: messageText.slice(0, 240),
    });
    pushToast(messageText, "error");
  } finally {
    releaseQuietSlot();
    mediaInFlight.delete(message.id);
    if (!quiet) setMediaBusyId(null);
  }
}
