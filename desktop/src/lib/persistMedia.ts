import type { Contact, Message } from "@/types/crm";

/** 超过此长度的 data URL 落盘时剥离，显著减小 SQLite/IDB 体积 */
export const PERSIST_MEDIA_MAX_CHARS = 8_000;

const DATA_URL_RE = /^data:/i;

export function isHeavyDataUrl(url: string | undefined | null): boolean {
  if (!url || !DATA_URL_RE.test(url)) return false;
  return url.length > PERSIST_MEDIA_MAX_CHARS;
}

/**
 * 落盘用消息：剥掉大体量 inline media，保留缩略图（若也过大则去掉）。
 * 内存中的 Message 不变，打开会话仍可用内存里的 mediaUrl；重启后靠补拉/重发。
 */
export function stripHeavyMediaForPersist(messages: Message[]): Message[] {
  let changed = false;
  const out: Message[] = new Array(messages.length);
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    const dropUrl = isHeavyDataUrl(m.mediaUrl);
    const dropThumb = isHeavyDataUrl(m.mediaThumbUrl);
    const dropSenderAvatar = DATA_URL_RE.test(m.senderAvatarUrl || "");
    if (!dropUrl && !dropThumb && !dropSenderAvatar) {
      out[i] = m;
      continue;
    }
    changed = true;
    out[i] = {
      ...m,
      mediaUrl: dropUrl ? undefined : m.mediaUrl,
      mediaThumbUrl: dropThumb ? undefined : m.mediaThumbUrl,
      senderAvatarUrl: dropSenderAvatar ? undefined : m.senderAvatarUrl,
      mediaPending: dropUrl ? true : m.mediaPending,
      // 标记曾有媒体，便于 UI 显示「重新加载」
      mediaType: m.mediaType || (dropUrl ? "image" : undefined),
    };
  }
  return changed ? out : messages;
}

export function stripHeavyContactMediaForPersist(
  contacts: Contact[]
): Contact[] {
  let changed = false;
  const out = contacts.map((contact) => {
    if (!DATA_URL_RE.test(contact.avatarFullUrl || "")) return contact;
    changed = true;
    return { ...contact, avatarFullUrl: undefined };
  });
  return changed ? out : contacts;
}
