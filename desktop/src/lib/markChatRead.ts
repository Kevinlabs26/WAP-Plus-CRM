import { useAppStore } from "@/store/appStore";
import { baileysChatModify, baileysMessagesRead } from "./baileys";
import { chatTarget } from "@/components/layout/chatSidebarUtils";
import type { ChatPreview, Contact } from "@/types/crm";

export function isBaileysChannel(): boolean {
  return useAppStore.getState().settings.sendChannel !== "android_bridge";
}

/**
 * 已读一个会话：清本地未读 +（Baileys 通道时）远端 markRead。
 * 供侧栏点开会话、一键全部已读、自动已读群消息共用。
 */
export async function markChatReadRemote(
  chat: ChatPreview,
  contact?: Contact | null,
  opts?: { skipRemote?: boolean }
): Promise<void> {
  const s = useAppStore.getState();
  // 本地先清（即时反馈）
  s.patchChat(chat.id, { unread: 0 });
  if (opts?.skipRemote) return;
  if (!isBaileysChannel()) return;

  const target = chatTarget(contact, chat);
  // 已读键（最近几条）提供可靠的 remoteJid，优先用作 jid 兜底
  const keys = inboundReadKeys(s, chat);
  const jid =
    target.jid ||
    target.channelAddress ||
    keys[0]?.remoteJid ||
    (target.phoneE164
      ? `${target.phoneE164.replace(/\D/g, "")}@s.whatsapp.net`
      : "");
  if (!jid) return; // 无有效地址，无法远端已读

  const accountId = contact?.accountId || chat.accountId;
  // 远端尽量尝试：bridge 未连接会返回错误（静默即可），不再因本地状态机
  // 判断不准而静默跳过——之前这里曾导致“本地读了、手机没读”。
  try {
    if (keys.length) {
      await baileysMessagesRead(keys, accountId);
    }
    await baileysChatModify("markRead", { jid, accountId });
  } catch {
    /* 本地已清未读；远端失败不打断 */
  }
}

/**
 * 收集会话最近的入站消息已读键（最多 3 条）。
 * WhatsApp 已读是累计的：标记最新一条为已读，之前的消息全部视为已读，
 * 因此大群（上千条）也只需一个请求，不用发全量键。
 * 群消息键缺 participant 时用 senderJid 补齐。
 */
function inboundReadKeys(
  s: ReturnType<typeof useAppStore.getState>,
  chat: ChatPreview
): Array<{ remoteJid: string; id: string; fromMe?: boolean; participant?: string }> {
  const out: Array<{
    remoteJid: string;
    id: string;
    fromMe?: boolean;
    participant?: string;
  }> = [];
  const limit = 3;
  let count = 0;
  for (let i = s.messages.length - 1; i >= 0 && count < limit; i--) {
    const m = s.messages[i];
    if (!m || m.chatId !== chat.id || m.direction !== "in") continue;
    const k = m.waKey;
    if (!k?.remoteJid || !k.id) continue;
    const participant =
      k.participant || (chat.isGroup ? m.senderJid : undefined) || undefined;
    out.push({
      remoteJid: k.remoteJid,
      id: k.id,
      fromMe: k.fromMe,
      ...(participant ? { participant } : {}),
    });
    count += 1;
  }
  return out;
}
