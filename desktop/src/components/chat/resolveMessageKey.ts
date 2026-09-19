import { resolveSendTarget } from "@/lib/utils";
import type { Contact, Message, WaMessageKey } from "@/types/crm";

type KeyContact = Pick<Contact, "id" | "phone" | "channelAddress">;

/** 协议操作用 key：优先 waKey，否则用 id + 联系人地址拼 */
export function resolveMessageKeyFrom(
  m: Message,
  contacts: KeyContact[],
  selectedContactId: string | null
): WaMessageKey | null {
  if (m.waKey?.id && m.waKey.remoteJid) return m.waKey;
  const id = (m.waMessageId || m.id || "").trim();
  // 本地乐观 id 不能当协议 id
  if (!id || id.startsWith("msg-") || id.startsWith("bridge-msg-"))
    return null;
  const contact = contacts.find(
    (c) => c.id === m.contactId || c.id === selectedContactId
  );
  const remote =
    resolveSendTarget({
      phone: contact?.phone,
      channelAddress: contact?.channelAddress,
      entityId: contact?.id || m.chatId,
    }) || "";
  if (!remote) return null;
  // E.164 → jid
  const remoteJid = remote.includes("@")
    ? remote.replace(/@c\.us$/, "@s.whatsapp.net")
    : `${remote.replace(/\D/g, "")}@s.whatsapp.net`;
  if (!remoteJid || remoteJid === "@s.whatsapp.net") return null;
  return {
    id,
    remoteJid,
    fromMe: m.direction === "out",
  };
}