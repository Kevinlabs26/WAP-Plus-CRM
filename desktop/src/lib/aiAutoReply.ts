import { resolveAutoReplyScope } from "./autoReplyScope";
import type { ChannelId } from "@/channels";
import type { ChatPreview, Contact, Message } from "@/types/crm";
import { useAppStore } from "@/store/appStore";
import { resolveSendTarget } from "@/lib/utils";
import { generateSuggestions, getSuggestionContextKey, hasRealAiKey } from "@/lib/aiSuggest";
import { isManualSuggestionContext } from "@/lib/aiSuggestionCache";
import { currentAutoReplyContext, hashAiReplyContext } from "@/lib/aiReplyContext";
import { sendTextMessage } from "@/components/chat/sendTextMessage";
import {
  canSendAutoReply,
  evaluateAutoReplyDecision,
  getAutoReplyOutputBlockReason,
  resolveAutoReplyPolicy,
} from "@/lib/aiSafety";
import { isWaAccountConnected } from "@/lib/accountConnection";
import { abortable } from "./abortable";
import { setAutoReplyRuntime, useAutoReplyRuntime, type AutoReplyPhase } from "./autoReplyRuntime";

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
const pendingByChat = new Map<string, Message>();
const cooldownTimers = new Map<string, ReturnType<typeof setTimeout>>();
const debounceTimers = new Map<string, { message: Message; timer: ReturnType<typeof setTimeout> }>();
const activeRequests = new Map<string, { id: string; sentAt: string; controller: AbortController }>();
const retries = new Map<string, { id: string; attempts: number; startedAt: number }>();
const mediaResyncAt = new Map<string, number>();
const mediaInFlight = new Set<string>();

/** Live short messages share a 1.2-second quiet period before generating. */
export function scheduleAutoReplyInbound(message: Message): void {
  if ((activeRequests.get(message.chatId)?.sentAt || "") > message.sentAt ||
      (debounceTimers.get(message.chatId)?.message.sentAt || "") > message.sentAt) return;
  activeRequests.get(message.chatId)?.controller.abort();
  const previous = debounceTimers.get(message.chatId);
  if (previous) clearTimeout(previous.timer);
  setAutoReplyRuntime(message.chatId, { phase: "waiting", inboundId: message.id, accountId: message.accountId });
  debounceTimers.set(message.chatId, { message, timer: setTimeout(() => {
    debounceTimers.delete(message.chatId);
    return autoReplyInbound(message);
  }, 1200) });
}

export function stopAutoReplies(): void {
  for (const timer of [...Array.from(debounceTimers.values(), item => item.timer), ...cooldownTimers.values()]) clearTimeout(timer);
  for (const request of activeRequests.values()) request.controller.abort();
  debounceTimers.clear(); cooldownTimers.clear(); pendingByChat.clear(); retries.clear();
  useAutoReplyRuntime.setState({ byChat: {} });
}

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
  if (!m.chatId) return;
  const active = activeRequests.get(m.chatId);
  if (active && (active.id === m.id || active.sentAt > m.sentAt)) return;
  const pending = pendingByChat.get(m.chatId);
  if (pending && pending.sentAt > m.sentAt) return;
  if (!pending || m.sentAt >= pending.sentAt) pendingByChat.set(m.chatId, m);
  setAutoReplyRuntime(m.chatId, { phase: "waiting", inboundId: m.id, accountId: m.accountId });
  active?.controller.abort();
  if (inFlightChats.has(m.chatId)) return;
  const timer = cooldownTimers.get(m.chatId);
  if (timer) clearTimeout(timer);
  cooldownTimers.delete(m.chatId);
  inFlightChats.add(m.chatId);
  try {
    while (pendingByChat.has(m.chatId)) {
      const next = pendingByChat.get(m.chatId)!;
      pendingByChat.delete(m.chatId);
      const recovery = retries.get(m.chatId);
      if (recovery?.id === next.id && Date.now() - recovery.startedAt >= 5 * 60_000) {
        retries.delete(m.chatId);
        if (next.contactId) logAutoDecision(next.contactId, "自动回复：需要人工处理", "等待超过 5 分钟，停止恢复旧消息");
        setAutoReplyRuntime(m.chatId, { phase: "human", inboundId: next.id, accountId: next.accountId, reason: "等待超过 5 分钟" }, next.id);
        continue;
      }
      const settings = useAppStore.getState().settings;
      const wait = (lastReplyAt.get(m.chatId) || 0) +
        Math.max(5000, Number(settings.aiAutoReplyIntervalMs) || 30000) - Date.now();
      if (resolveAutoReplyScope(settings, m.chatId).mode === "auto" && wait > 0) {
        pendingByChat.set(m.chatId, next);
        cooldownTimers.set(m.chatId, setTimeout(() => autoReplyInbound(next), wait));
        break;
      }
      const controller = new AbortController();
      activeRequests.set(m.chatId, { id: next.id, sentAt: next.sentAt, controller });
      let retry = false;
      try { retry = await autoReplyInboundOnce(next, controller.signal) === "retry"; }
      catch (error) {
        if (!controller.signal.aborted) {
          const reason = error instanceof Error ? error.message : String(error);
          if (next.contactId) logAutoDecision(next.contactId, "自动回复：未发送", reason);
          setAutoReplyRuntime(m.chatId, { phase: "human", inboundId: next.id, accountId: next.accountId, reason }, next.id);
        }
      } finally { activeRequests.delete(m.chatId); }
      if (retry && !controller.signal.aborted && !pendingByChat.has(m.chatId)) {
        const previous = retries.get(m.chatId);
        const attempt = previous?.id === next.id ? previous : { id: next.id, attempts: 0, startedAt: Date.now() };
        // shortcut: pre-send recovery is memory-only and expires after five minutes; no delivery is replayed here.
        if (attempt.attempts < 3 && Date.now() - attempt.startedAt < 5 * 60_000) {
          const delay = 10_000 * 2 ** attempt.attempts++;
          retries.set(m.chatId, attempt);
          cooldownTimers.set(m.chatId, setTimeout(() => autoReplyInbound(next), delay));
          setAutoReplyRuntime(m.chatId, { phase: "retry", inboundId: next.id, accountId: next.accountId, retryAt: Date.now() + delay,
            reason: useAutoReplyRuntime.getState().byChat[m.chatId]?.reason }, next.id);
          if (next.contactId) logAutoDecision(next.contactId, "自动回复：等待重试", `${Math.ceil(delay / 1000)} 秒后重新检查，最多重试 3 次`);
          break;
        }
        if (next.contactId) logAutoDecision(next.contactId, "自动回复：需要人工处理", "重试次数或等待时间已达上限");
        setAutoReplyRuntime(m.chatId, { phase: "human", inboundId: next.id, accountId: next.accountId, reason: "重试次数或等待时间已达上限" }, next.id);
      }
      const runtime = useAutoReplyRuntime.getState().byChat[m.chatId];
      if (!controller.signal.aborted && runtime?.inboundId === next.id && runtime.phase !== "human") setAutoReplyRuntime(m.chatId, null, next.id);
      retries.delete(m.chatId);
    }
  } finally {
    inFlightChats.delete(m.chatId);
  }
}

/**
 * 自动回复一条实时入站私聊消息。
 * 非适用场景（未开启、群聊）保持安静；可诊断的跳过原因写入联系人活动记录。
 */
async function autoReplyInboundOnce(m: Message, signal: AbortSignal): Promise<"retry" | void> {
  let state = useAppStore.getState();
  const settings = state.settings;
  const scope = resolveAutoReplyScope(settings, m.chatId);
  if (scope.mode !== "auto") {
    if (m.contactId && (scope.source === "chat" || scope.source === "folder")) {
      logAutoSkipOnce(m.chatId, m.contactId, `scope:${scope.source}`, "自动回复：仅人工",
        scope.source === "folder" ? `来自文件夹「${scope.folderName}」` : "该会话已设置为只人工处理");
    }
    return;
  }
  if (m.isGroup) return; // 仅私聊
  if (!m.chatId || !m.contactId) return;
  let conversation = state.messagesByChatId?.[m.chatId] || state.messages.filter(x => x.chatId === m.chatId).sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  if (conversation.filter(x => x.direction === "in").at(-1)?.id !== m.id ||
      conversation.some(x => x.direction === "out" && x.systemKind === "ai_auto_reply" && x.sentAt >= m.sentAt &&
        (x.deliveryStatus !== "failed" || x.deliveryUncertain))) return;
  m = conversation.find(x => x.id === m.id) || m;

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
      m.contactId!,
      `cooldown:${Math.floor(now / interval)}`,
      "自动回复：冷却中",
      `同会话最小间隔尚未结束，约 ${remaining} 秒后再处理`
    );
    return;
  }

  const contact = state.contacts.find((c) => c.id === m.contactId);
  const chat = state.chats.find((c) => c.id === m.chatId);
  if (!contact || !chat || contact.isGroup || chat.isGroup) return;
  const accountId =
    m.accountId ||
    chat.accountId ||
    contact.accountId ||
    settings.liveBaileysAccountId ||
    settings.activeAccountId;
  const runtime = (phase: AutoReplyPhase, reason?: string) => setAutoReplyRuntime(m.chatId, { phase, inboundId: m.id, accountId, reason }, m.id);
  if (chat.localOnly) return; // 本地会话不自动回

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
        "WhatsApp 账号未连接，将限次重试并重新核对上下文"
      );
      return "retry";
    }
  } else {
    if (!state.bridge.connected) {
      logAutoSkipOnce(
        m.chatId,
        contact.id,
        "bridge-offline",
        "自动回复：未发送",
        "手机桥接未连接，将限次重试并重新核对上下文"
      );
      return "retry";
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

  const policy = resolveAutoReplyPolicy(settings.aiAutoReplyPolicy, settings.aiAutoReplyPolicyByAccountId, accountId);
  const beforeVoice = evaluateAutoReplyDecision(conversation, m, Date.now(), policy);
  if (!beforeVoice.allow && (beforeVoice.kind !== "risk" || !["audio", "ptt"].includes(m.mediaType || "") || !!m.transcript)) {
    logAutoSkipOnce(m.chatId, contact.id, `decision:${beforeVoice.kind}`, "自动回复：暂停", beforeVoice.reason);
    return;
  }
  const lastOut = conversation.map(x => x.direction).lastIndexOf("out");
  const voices = ["audio", "ptt"].includes(m.mediaType || "")
    ? conversation.slice(lastOut + 1).filter(x => x.direction === "in" && ["audio", "ptt"].includes(x.mediaType || "") && !x.transcript) : [];
  for (const voice of voices) {
    if (signal.aborted) return;
    runtime("transcribing");
    if (!voice.mediaUrl) {
      const { reloadMedia } = await import("@/components/chat/reloadMediaAction");
      const { resolveMessageKeyFrom } = await import("@/components/chat/resolveMessageKey");
      await abortable(reloadMedia({ message: voice, sourceMessage: voice, isBaileys: channelId === "baileys", chatConnected: true,
        chatAccountId: accountId || "", activeContactName: contact.name, mediaResyncAt, mediaInFlight,
        setMediaBusyId: () => {}, resolveMessageKey: message => resolveMessageKeyFrom(message, [contact], contact.id),
        updateMessageDelivery: state.updateMessageDelivery, pushToast: () => {}, quiet: true, signal }), signal);
    }
    if (signal.aborted) return;
    const current = useAppStore.getState().messages.find(x => x.id === voice.id);
    if (!current?.mediaUrl) return "retry";
    const { transcribeVoice } = await import("@/lib/transcribeVoice");
    const result = await abortable(transcribeVoice(current.mediaUrl, current.mediaMime || "audio/ogg", settings, { signal, language: "" }), signal);
    if (signal.aborted || !useAppStore.getState().messages.some(x => x.id === voice.id && x.chatId === m.chatId)) return;
    if (result.fallback || !result.text.trim()) {
      logAutoDecision(contact.id, "自动回复：语音未识别", result.error || "转写为空，请人工处理");
      runtime("human", result.error || "语音转写为空");
      return /正在转写|fetch|network|timeout|超时|\b(?:429|5\d\d)\b/i.test(result.error || "") ? "retry" : undefined;
    }
    useAppStore.getState().patchMessage(voice.id, { transcript: result.text.trim() });
  }
  if (signal.aborted) return;
  state = useAppStore.getState();
  conversation = state.messagesByChatId?.[m.chatId] || state.messages.filter(x => x.chatId === m.chatId).sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  m = conversation.find(x => x.id === m.id) || m;
  if (resolveAutoReplyScope(state.settings, m.chatId).mode !== "auto") return;
  const decision = evaluateAutoReplyDecision(conversation, m, Date.now(), policy);
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
  const contextKey = getSuggestionContextKey(contact, conversation, settings, accountId, { auto: true });
  if (isManualSuggestionContext(getSuggestionContextKey(contact, conversation, settings, accountId))) return;
  runtime("generating");
  const result = await generateSuggestions(contact, conversation, settings, {
    auto: true,
    accountId,
    signal,
  });
  if (signal.aborted) return;
  // API 失败回退的本地模板绝不能自动发给真实客户
  if (result.fallback || result.source === "mock") {
    logAutoDecision(contact.id, "自动回复：未发送", result.error || "AI 不可用");
    runtime("human", result.error || "AI 不可用");
    return result.retryable ? "retry" : undefined;
  }
  const reply = result.suggestions[0]?.text?.trim();
  if (!reply) {
    logAutoDecision(contact.id, "自动回复：未发送", "AI 没有返回有效内容");
    runtime("human", "AI 没有返回有效内容");
    return;
  }
  // 生成期间用户可能接管、关闭自动回复，或收到更新的消息。
  const fresh = useAppStore.getState();
  const freshThread = fresh.messagesByChatId?.[m.chatId] || fresh.messages.filter((x) => x.chatId === m.chatId)
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  const latestInbound = freshThread.filter((x) => x.direction === "in").at(-1);
  const freshContact = fresh.contacts.find((x) => x.id === contact.id);
  const freshChat = fresh.chats.find((x) => x.id === chat.id);
  const originalIds = new Set(conversation.map((x) => x.id));
  if (resolveAutoReplyScope(fresh.settings, m.chatId).mode !== "auto" ||
      pendingByChat.has(m.chatId) || latestInbound?.id !== m.id ||
      !freshContact || !freshChat || freshChat.localOnly ||
      getSuggestionContextKey(freshContact, freshThread, fresh.settings, accountId, { auto: true }) !== contextKey ||
      isManualSuggestionContext(getSuggestionContextKey(freshContact, freshThread, fresh.settings, accountId)) ||
      freshThread.some((x) => x.direction === "out" && !x.systemKind && !originalIds.has(x.id)) ||
      fresh.settings.sendChannel !== settings.sendChannel ||
      fresh.settings.aiProvider !== settings.aiProvider ||
      fresh.settings.customAiBaseUrl !== settings.customAiBaseUrl ||
      fresh.settings.ollamaUrl !== settings.ollamaUrl ||
      (freshChat.accountId || freshContact.accountId || fresh.settings.liveBaileysAccountId || fresh.settings.activeAccountId) !== accountId) return;
  const freshPolicy = resolveAutoReplyPolicy(fresh.settings.aiAutoReplyPolicy,
    fresh.settings.aiAutoReplyPolicyByAccountId, accountId);
  if (!evaluateAutoReplyDecision(freshThread, m, Date.now(), freshPolicy).allow) return;
  lastSkipLogByChat.delete(m.chatId);
  const outputBlockReason = getAutoReplyOutputBlockReason(reply, {
    allowPricing: freshPolicy.allowPricing,
  });
  if (outputBlockReason) {
    logAutoDecision(contact.id, "自动回复：输出转人工", outputBlockReason);
    runtime("human", outputBlockReason);
    return;
  }
  lastReplyAt.set(m.chatId, Date.now());

  const queued = await sendAutoReplyText({
    text: reply,
    contact: freshContact,
    chat: freshChat,
    accountId,
    channelId,
    phoneId: freshChat.phoneId,
    inboundId: m.id,
    contextKey,
  });
  if (!queued) runtime("human", "收件人、会话或发送状态需要检查");
  logAutoDecision(
    contact.id,
    queued ? "自动回复：已加入发送队列" : "自动回复：发送失败",
    queued ? `模型：${result.source}` : "收件人或会话信息不完整"
  );
}

/** 自动回复发送：入队 + 走标准发送管线（保留限速/过热拦截），无成功打扰 */
export async function sendAutoReplyText(opts: {
  text: string;
  inboundId?: string;
  contextKey?: string;
  contact: Contact;
  chat: ChatPreview | undefined;
  accountId?: string;
  channelId: ChannelId;
  phoneId?: string;
}): Promise<boolean> {
  let state = useAppStore.getState();
  if (!opts.chat || resolveAutoReplyScope(state.settings, opts.chat.id).mode !== "auto") return false;
  const isBaileys = opts.channelId === "baileys";
  const recipient = resolveSendTarget({
    phone: opts.contact.phone,
    channelAddress: isBaileys ? opts.contact.channelAddress : undefined,
    jid: isBaileys ? opts.contact.channelAddress : undefined,
    entityId: isBaileys ? opts.contact.id : undefined,
  });
  if (!recipient || !opts.chat) return false;
  const pendingContext = { id: "", chatId: opts.chat.id, contactId: opts.contact.id,
    accountId: opts.accountId, channelId: opts.channelId };
  const contextKey = currentAutoReplyContext(state, pendingContext);
  if (!contextKey || (opts.contextKey && opts.contextKey !== contextKey)) return false;
  const aiReplyContextHash = await hashAiReplyContext(contextKey);
  state = useAppStore.getState();
  if (resolveAutoReplyScope(state.settings, opts.chat.id).mode !== "auto" || currentAutoReplyContext(state, pendingContext) !== contextKey) return false;

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
    aiReplyContextHash,
  });
  if (!msgId) return false;
  // enqueueOutgoingMessage 会清空 draftReply，恢复用户在其它会话正在打的草稿
  const st2 = useAppStore.getState();
  if (st2.draftReply !== draftBefore) {
    st2.setDraftReply(draftBefore);
  }

  await sendTextMessage({
    msgId,
    canSend: () => {
      const latest = useAppStore.getState();
      const message = latest.messages.find((item) => item.id === msgId);
      if (!message || message.deliveryStatus !== "pending") return false;
      return latest.settings.sendChannel === opts.channelId &&
        latest.chats.some((item) => item.id === message.chatId && !item.localOnly) &&
        latest.contacts.some((item) => item.id === message.contactId) &&
        currentAutoReplyContext(latest, message) === contextKey &&
        canSendAutoReply(latest.settings, latest.messages, message, opts.inboundId);
    },
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
  const status = useAppStore.getState().messages.find((item) => item.id === msgId)?.deliveryStatus;
  return !!status && status !== "failed";
}
