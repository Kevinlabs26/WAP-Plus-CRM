import type { ChannelId } from "@/channels";
import type { ChatPreview, Contact, Message } from "@/types/crm";
import { useAppStore } from "@/store/appStore";
import { resolveSendTarget } from "@/lib/utils";
import { generateSuggestions, hasRealAiKey } from "@/lib/aiSuggest";
import { sendTextMessage } from "@/components/chat/sendTextMessage";
import {
  evaluateAutoReplyDecision,
  getAutoReplyOutputBlockReason,
  resolveAutoReplyPolicy,
} from "@/lib/aiSafety";
import { isWaAccountConnected } from "@/lib/accountConnection";

/**
 * 实时入站消息事件总线：ingestSlice 在 live 消息入库后 emit，
 * AiAutoReplier 订阅处理。避免每次 store 变更全量扫描消息数组。
 */
type InboundHandler = (messages: Message[]) => void;
const inboundHandlers = new Set<InboundHandler>();

export function onLiveInboundMessages(
  handler: InboundHandler
): () => void {
  inboundHandlers.add(handler);
  return () => {
    inboundHandlers.delete(handler);
  };
}

export function emitLiveInboundMessages(messages: Message[]): void {
  if (!messages.length) return;
  for (const handler of [...inboundHandlers]) {
    try {
      handler(messages);
    } catch {
      /* 单个订阅方异常不影响其它逻辑 */
    }
  }
}

/** 同会话自动回复最小间隔（毫秒） */
const lastReplyAt = new Map<string, number>();
const lastTakeoverLogByChat = new Map<string, string>();
const lastSkipLogByChat = new Map<string, string>();
const inFlightChats = new Set<string>();

function logAutoDecision(
  contactId: string,
  title: string,
  detail?: string
): void {
  useAppStore.getState().logActivity(contactId, "system", title, detail);
}

function logAutoSkipOnce(
  chatId: string,
  contactId: string,
  key: string,
  title: string,
  detail: string
): void {
  if (lastSkipLogByChat.get(chatId) === key) return;
  lastSkipLogByChat.set(chatId, key);
  logAutoDecision(contactId, title, detail);
}

export async function autoReplyInbound(m: Message): Promise<void> {
  if (!m.chatId || inFlightChats.has(m.chatId)) return;
  inFlightChats.add(m.chatId);
  try {
    await autoReplyInboundOnce(m);
  } finally {
    inFlightChats.delete(m.chatId);
  }
}

/**
 * 自动回复一条实时入站私聊消息。
 * 非适用场景（未开启、群聊）保持安静；可诊断的跳过原因写入联系人活动记录。
 */
async function autoReplyInboundOnce(m: Message): Promise<void> {
  const state = useAppStore.getState();
  const settings = state.settings;
  if (settings.aiReplyMode !== "auto") return;
  if (m.isGroup) return; // 仅私聊
  if (!m.chatId || !m.contactId) return;

  const interval = Math.max(
    5000,
    Number(settings.aiAutoReplyIntervalMs) || 30000
  );
  const now = Date.now();
  if (now - (lastReplyAt.get(m.chatId) || 0) < interval) {
    const remaining = Math.max(
      1,
      Math.ceil((interval - (now - (lastReplyAt.get(m.chatId) || 0))) / 1000)
    );
    logAutoSkipOnce(
      m.chatId,
      m.contactId,
      `cooldown:${Math.floor(now / interval)}`,
      "自动回复：冷却中",
      `同会话最小间隔尚未结束，约 ${remaining} 秒后再处理`
    );
    return;
  }

  const contact = state.contacts.find((c) => c.id === m.contactId);
  const chat = state.chats.find((c) => c.id === m.chatId);
  if (!contact || !chat) return;
  const accountId =
    m.accountId ||
    chat.accountId ||
    contact.accountId ||
    settings.liveBaileysAccountId ||
    settings.activeAccountId;
  if (chat.localOnly) return; // 本地会话不自动回
  if (settings.aiAutoReplyManualChatIds.includes(m.chatId)) {
    if (lastTakeoverLogByChat.get(m.chatId) !== "manual-only") {
      lastTakeoverLogByChat.set(m.chatId, "manual-only");
      logAutoDecision(contact.id, "自动回复：仅人工", "该会话已设置为只人工处理");
    }
    return;
  }

  const channelId: ChannelId =
    settings.sendChannel === "android_bridge" ? "android_bridge" : "baileys";
  if (channelId === "baileys") {
    if (
      !isWaAccountConnected(
        settings.waAccounts,
        accountId,
        settings.liveBaileysAccountId,
        state.baileysUi.connection
      )
    ) {
      logAutoSkipOnce(
        m.chatId,
        contact.id,
        `offline:${accountId || "default"}`,
        "自动回复：未发送",
        "WhatsApp 账号未连接，消息会保留给人工处理"
      );
      return;
    }
  } else {
    if (!state.bridge.connected) {
      logAutoSkipOnce(
        m.chatId,
        contact.id,
        "bridge-offline",
        "自动回复：未发送",
        "手机桥接未连接，消息会保留给人工处理"
      );
      return;
    }
  }
  if (!hasRealAiKey(settings)) {
    logAutoSkipOnce(
      m.chatId,
      contact.id,
      "missing-ai-key",
      "自动回复：未发送",
      "未配置真实 AI Key；演示模板不会自动发送"
    );
    return;
  }

  const thread = state.messages
    .filter((x) => x.chatId === m.chatId)
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt))
    .slice(-14);
  const policy = resolveAutoReplyPolicy(
    settings.aiAutoReplyPolicy,
    settings.aiAutoReplyPolicyByAccountId,
    accountId
  );
  const decision = evaluateAutoReplyDecision(thread, m, Date.now(), policy);
  if (!decision.allow) {
    if (
      decision.kind !== "manual_takeover" ||
      lastTakeoverLogByChat.get(m.chatId) !== decision.takeoverKey
    ) {
      if (decision.takeoverKey) {
        lastTakeoverLogByChat.set(m.chatId, decision.takeoverKey);
      }
      logAutoDecision(
        contact.id,
        decision.kind === "manual_takeover"
          ? "自动回复：人工接管"
          : decision.kind === "outside_hours"
            ? "自动回复：非生效时段"
            : "自动回复：转人工",
        decision.reason
      );
    }
    return;
  }
  const result = await generateSuggestions(contact, thread, settings, {
    auto: true,
    accountId,
  });
  // API 失败回退的本地模板绝不能自动发给真实客户
  if (result.fallback || result.source === "mock") {
    logAutoDecision(contact.id, "自动回复：未发送", result.error || "AI 不可用");
    return;
  }
  const reply = result.suggestions[0]?.text?.trim();
  if (!reply) {
    logAutoDecision(contact.id, "自动回复：未发送", "AI 没有返回有效内容");
    return;
  }
  lastSkipLogByChat.delete(m.chatId);
  const outputBlockReason = getAutoReplyOutputBlockReason(reply, {
    allowPricing: policy.allowPricing,
  });
  if (outputBlockReason) {
    logAutoDecision(contact.id, "自动回复：输出转人工", outputBlockReason);
    return;
  }
  lastReplyAt.set(m.chatId, now);

  const queued = await sendAutoReplyText({
    text: reply,
    contact,
    chat,
    accountId,
    channelId,
    phoneId: chat.phoneId,
  });
  logAutoDecision(
    contact.id,
    queued ? "自动回复：已加入发送队列" : "自动回复：发送失败",
    queued ? `模型：${result.source}` : "收件人或会话信息不完整"
  );
}

/** 自动回复发送：入队 + 走标准发送管线（保留限速/过热拦截），无成功打扰 */
export async function sendAutoReplyText(opts: {
  text: string;
  contact: Contact;
  chat: ChatPreview | undefined;
  accountId?: string;
  channelId: ChannelId;
  phoneId?: string;
}): Promise<boolean> {
  const state = useAppStore.getState();
  const isBaileys = opts.channelId === "baileys";
  const recipient = resolveSendTarget({
    phone: opts.contact.phone,
    channelAddress: isBaileys ? opts.contact.channelAddress : undefined,
    jid: isBaileys ? opts.contact.channelAddress : undefined,
    entityId: isBaileys ? opts.contact.id : undefined,
  });
  if (!recipient || !opts.chat) return false;

  const draftBefore = state.draftReply;
  const msgId = state.enqueueOutgoingMessage({
    chatId: opts.chat.id,
    body: opts.text,
    phoneE164: recipient,
    contactId: opts.contact.id,
    channelId: opts.channelId,
    deviceId: opts.phoneId ?? null,
    accountId: opts.accountId,
    deliveryStatus: "pending",
    systemKind: "ai_auto_reply",
  });
  if (!msgId) return false;
  // enqueueOutgoingMessage 会清空 draftReply，恢复用户在其它会话正在打的草稿
  const st2 = useAppStore.getState();
  if (st2.draftReply !== draftBefore) {
    st2.setDraftReply(draftBefore);
  }

  await sendTextMessage({
    msgId,
    text: opts.text,
    recipient,
    contact: opts.contact,
    activeChat: opts.chat,
    selectedPhoneId: opts.phoneId ?? null,
    channelId: opts.channelId,
    chatAccountId: opts.accountId ?? "",
    settings: st2.settings,
    messages: st2.messages,
    quoted: undefined,
    mentionedJid: undefined,
    updateMessageDelivery: st2.updateMessageDelivery,
    setBaileysLoginOpen: () => {},
    setReplyTo: () => {},
    clearDraft: () => {},
    clearMentions: () => {},
    setSending: () => {},
    pushToast: (message, tone) => {
      // 自动回复不弹成功/排队提示，只在彻底失败时提醒
      if (tone === "error") useAppStore.getState().pushToast(message, "error");
    },
  });
  return true;
}
