import { baileysChatModify } from "./baileys";
import type { ChatPreview } from "@/types/crm";

export const MUTE_8_HOURS = 8 * 60 * 60 * 1000;
export const MUTE_7_DAYS = 7 * 24 * 60 * 60 * 1000;
export const MUTE_FOREVER = 100 * 365 * 24 * 60 * 60 * 1000;

type Target = {
  jid?: string;
  phoneE164?: string;
  channelAddress?: string;
  accountId?: string | null;
};

export async function applyChatPreference(input: {
  action: "pin" | "unpin" | "mute" | "unmute";
  chat: ChatPreview;
  target: Target;
  isBaileys: boolean;
  connected: boolean;
  durationMs?: number;
  patchChat: (chatId: string, patch: Partial<ChatPreview>) => void;
  pushToast: (message: string, tone?: "info" | "success" | "error") => void;
}) {
  const { action, chat, target, isBaileys, connected, patchChat, pushToast } = input;
  let remoteOk = !isBaileys;
  let remoteError = "";
  if (isBaileys && connected) {
    try {
      await baileysChatModify(
        action,
        target,
        action === "mute" ? { durationMs: input.durationMs } : undefined
      );
      remoteOk = true;
    } catch (error) {
      remoteError = error instanceof Error ? error.message : "同步失败";
    }
  } else if (isBaileys) {
    remoteError = "未连接";
  }

  if (action === "pin" || action === "unpin") {
    patchChat(chat.id, { pinned: action === "pin" });
    const label = action === "pin" ? "置顶" : "取消置顶";
    pushToast(remoteOk ? `已${label}` : `本地已${label}（${remoteError}）`, remoteOk ? "success" : "info");
    return;
  }

  const duration = input.durationMs ?? MUTE_8_HOURS;
  patchChat(chat.id, { mutedUntil: action === "mute" ? Date.now() + duration : null });
  const durationLabel = duration >= MUTE_FOREVER ? "永久" : duration >= MUTE_7_DAYS ? "7 天" : "8 小时";
  const label = action === "mute" ? `静音（${durationLabel}）` : "关闭静音";
  pushToast(remoteOk ? `已${label}` : `本地已${label}（${remoteError}）`, remoteOk ? "success" : "info");
}
