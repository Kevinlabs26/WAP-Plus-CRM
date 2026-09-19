import type { ChatPreview } from "@/types/crm";
import { looksLikeMessageAsName } from "@/lib/utils";

export function isInternalContactName(n: string, opts?: { isGroup?: boolean }): boolean {
  if (!n) return true;
  const t = n.trim().toLowerCase();
  if (
    t === "未知联系人" ||
    t === "未知" ||
    t === "unknown" ||
    t === "号码解析中…" ||
    t === "号码解析中..." ||
    t === "未备注联系人"
  )
    return true;
  // 单独的「群聊」是占位，真群名不要当内部名
  if (t === "群聊") return true;
  if (
    n.includes("@lid") ||
    n.includes("@s.whatsapp.net") ||
    n.includes("@g.us")
  )
    return true;
  const compact = n.replace(/[\s().-]/g, "");
  if (/^\d{10,}$/.test(n) || /^\+?\d{7,15}$/.test(compact)) return true;
  // 群 subject 可以很长、带标点，不能按私聊「消息当名」误杀
  if (!opts?.isGroup && looksLikeMessageAsName(n)) return true;
  return false;
}

export function looksLikeSelfContact(
  c: { name?: string; phone?: string; channelAddress?: string },
  selfName: string
): boolean {
  if (selfName && (c.name || "").trim() === selfName) {
    const ph = (c.phone || "").trim();
    if (!ph || ph === selfName) return true;
  }
  return false;
}

export function applyNameToChats(
  chats: ChatPreview[],
  contactId: string,
  label: string,
  opts?: { isGroup?: boolean }
): ChatPreview[] {
  if (!label || isInternalContactName(label, opts)) return chats;
  return chats.map((ch) =>
    ch.contactId === contactId
      ? {
          ...ch,
          contactName:
            !ch.contactName ||
            isInternalContactName(ch.contactName, {
              isGroup: opts?.isGroup || ch.isGroup,
            })
              ? label
              : ch.contactName,
        }
      : ch
  );
}
