import { autoReplyDelayRange } from "./autoReplyDelay";
import { resolveAutoReplyScope } from "./autoReplyScope";
import type { ChannelId } from "@/channels";
import type { ChatPreview, Contact, Message } from "@/types/crm";
import { useAppStore } from "@/store/appStore";
import { resolveSendTarget } from "@/lib/utils";
import { generateSuggestions, getSuggestionContextKey, hasRealAiKey } from "@/lib/aiSuggest";
import { isManualSuggestionContext, SUGGESTION_MAX_AGE_MS } from "@/lib/aiSuggestionCache";
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
const takeoverWaits = new Map<string, { message: Message; timer: ReturnType<typeof setTimeout> }>();
const pausedByChat = new Map<string, Message>();
const debounceTimers = new Map<string, { message: Message; timer: ReturnType<typeof setTimeout> }>();
const activeRequests = new Map<string, { id: string; sentAt: string; controller: AbortController }>();
const retries = new Map<string, { id: string; attempts: number; startedAt: number }>();
const mediaResyncAt = new Map<string, number>();
const mediaInFlight = new Set<string>();
const isVoiceMessage = (message: Message) => ["audio", "ptt"].includes(message.mediaType || "") || message.mediaPtt === true || Boolean(message.mediaMime?.toLowerCase().startsWith("audio/"));

function canScheduleAutoReply(message: Message,ignorePause=false): boolean {
  const state=useAppStore.getState();
  const chat=state.chats.find(chat=>chat.id===message.chatId);
  const contact=state.contacts.find(contact=>contact.id===chat?.contactId);
  return message.direction==="in"&&!message.isGroup&&!!chat&&!chat.isGroup&&!chat.localOnly&&!!contact&&!contact.isGroup&&
    !contact.channelAddress?.endsWith("@g.us")&&resolveAutoReplyScope(ignorePause?{...state.settings,aiAutoReplyPaused:false}:state.settings,message.chatId).mode==="auto";
}

/** Wait before generating so a delayed reply does not expire in the send queue. */
export function scheduleAutoReplyInbound(message: Message): void {
  if(useAppStore.getState().settings.aiAutoReplyPaused){holdPausedReply(message);return;}
  if (!canScheduleAutoReply(message)) return;
  if (useAppStore.getState().settings.aiTaskDismissedIds?.includes(`runtime:${message.chatId}:${message.id}`)) return;
  if ((activeRequests.get(message.chatId)?.sentAt || "") > message.sentAt ||
      (debounceTimers.get(message.chatId)?.message.sentAt || "") > message.sentAt) return;
  const takeover = takeoverWaits.get(message.chatId);
  if (takeover) { clearTimeout(takeover.timer); takeoverWaits.delete(message.chatId); }
  activeRequests.get(message.chatId)?.controller.abort();
  const previous = debounceTimers.get(message.chatId);
  if (previous) clearTimeout(previous.timer);
  const range=autoReplyDelayRange(useAppStore.getState().settings);
  const delay=Math.max(1200,range.min+Math.floor(Math.random()*(range.max-range.min+1)));
  setAutoReplyRuntime(message.chatId, { phase: "waiting", inboundId: message.id, accountId: message.accountId, reason:"等待回复间隔", retryAt:Date.now()+delay });
  debounceTimers.set(message.chatId, { message, timer: setTimeout(() => {
    debounceTimers.delete(message.chatId);
    return autoReplyInbound(message);
  }, delay) });
}

export function stopAutoReplies(): void {
  for (const timer of [...Array.from(debounceTimers.values(), item => item.timer), ...cooldownTimers.values()]) clearTimeout(timer);
  for (const request of activeRequests.values()) request.controller.abort();
  for (const wait of takeoverWaits.values()) clearTimeout(wait.timer);
  takeoverWaits.clear();
  pausedByChat.clear();
  debounceTimers.clear(); cooldownTimers.clear(); pendingByChat.clear(); retries.clear();
  useAutoReplyRuntime.setState({ byChat: {} });
}

function holdPausedReply(message: Message): void {
  if(!canScheduleAutoReply(message,true)||useAppStore.getState().settings.aiTaskDismissedIds?.includes(`runtime:${message.chatId}:${message.id}`))return;
  const previous=pausedByChat.get(message.chatId);
  if(previous&&previous.sentAt>message.sentAt)return;
  pausedByChat.set(message.chatId,message);
  setAutoReplyRuntime(message.chatId,{phase:"waiting",inboundId:message.id,accountId:message.accountId,reason:"AI 总开关已暂停"});
}

export function refreshAutoReplyPause(): void {
  const state=useAppStore.getState();
  if(state.settings.aiAutoReplyPaused){
    for(const [chatId,runtime] of Object.entries(useAutoReplyRuntime.getState().byChat)){
      if(runtime.phase==="human")continue;
      const message=state.messages.find(message=>message.id===runtime.inboundId&&message.chatId===chatId);
      if(!message)continue;
      clearTimeout(debounceTimers.get(chatId)?.timer);debounceTimers.delete(chatId);
      clearTimeout(cooldownTimers.get(chatId));cooldownTimers.delete(chatId);
      clearTimeout(takeoverWaits.get(chatId)?.timer);takeoverWaits.delete(chatId);
      activeRequests.get(chatId)?.controller.abort();pendingByChat.delete(chatId);retries.delete(chatId);
      holdPausedReply(message);
    }
  }else{
    for(const message of pausedByChat.values())scheduleAutoReplyInbound(message);
    pausedByChat.clear();
  }
}

export function stopAutoReplyTask(chatId:string,inboundId?:string,messageId?:string):void{
  const state=useAppStore.getState(),keys=[...(state.settings.aiTaskDismissedIds||[])];
  if(inboundId){
    keys.push(`runtime:${chatId}:${inboundId}`);
    if(debounceTimers.get(chatId)?.message.id===inboundId){clearTimeout(debounceTimers.get(chatId)?.timer);debounceTimers.delete(chatId);}
    if(takeoverWaits.get(chatId)?.message.id===inboundId){clearTimeout(takeoverWaits.get(chatId)?.timer);takeoverWaits.delete(chatId);}
    if(useAutoReplyRuntime.getState().byChat[chatId]?.inboundId===inboundId||retries.get(chatId)?.id===inboundId){clearTimeout(cooldownTimers.get(chatId));cooldownTimers.delete(chatId);}
    if(pendingByChat.get(chatId)?.id===inboundId)pendingByChat.delete(chatId);
    if(pausedByChat.get(chatId)?.id===inboundId)pausedByChat.delete(chatId);
    if(retries.get(chatId)?.id===inboundId)retries.delete(chatId);
    if(activeRequests.get(chatId)?.id===inboundId)activeRequests.get(chatId)?.controller.abort();
    setAutoReplyRuntime(chatId,null,inboundId);
  }
  for(const message of state.messages)if(message.chatId===chatId&&message.systemKind==="ai_auto_reply"&&(message.id===messageId||inboundId&&message.aiReplyInboundId===inboundId)){
    keys.push(`reply:${message.id}`);
    if(["pending","queued","failed"].includes(message.deliveryStatus||"")&&!message.deliveryUncertain)state.updateMessageDelivery(message.id,{deliveryStatus:"failed",retryCount:5,nextAttemptAt:undefined,lastError:"本次自动回复已停止"});
  }
  state.updateSettings({aiTaskDismissedIds:[...new Set(keys)]});
}

export function stopChatAutoReply(chatId: string): void {
  const state=useAppStore.getState();
  const inbound=(state.messagesByChatId?.[chatId]||state.messages.filter(message=>message.chatId===chatId)).filter(message=>message.direction==="in").at(-1);
  if(inbound)state.updateSettings({aiTaskDismissedIds:[...new Set([...(state.settings.aiTaskDismissedIds||[]),`runtime:${chatId}:${inbound.id}`])]});
  clearTimeout(debounceTimers.get(chatId)?.timer);
  clearTimeout(cooldownTimers.get(chatId));
  clearTimeout(takeoverWaits.get(chatId)?.timer);
  debounceTimers.delete(chatId);cooldownTimers.delete(chatId);takeoverWaits.delete(chatId);
  pendingByChat.delete(chatId);retries.delete(chatId);
  pausedByChat.delete(chatId);
  activeRequests.get(chatId)?.controller.abort();
  for(const message of state.messages)if(message.chatId===chatId&&message.systemKind==="ai_auto_reply"&&["pending","queued","failed"].includes(message.deliveryStatus||"")&&!message.deliveryUncertain)
    state.updateMessageDelivery(message.id,{deliveryStatus:"failed",retryCount:5,nextAttemptAt:undefined,lastError:"本次自动回复已停止"});
  setAutoReplyRuntime(chatId,null);
}

export async function retryAutoReplyTask(chatId:string,inboundId?:string,messageId?:string,regenerate=false):Promise<boolean>{
  const state=useAppStore.getState();
  const message=messageId?state.messages.find(message=>message.id===messageId&&message.chatId===chatId&&message.systemKind==="ai_auto_reply"):undefined;
  if(messageId&&(!message||message.deliveryUncertain||message.deliveryStatus!=="failed"))return false;
  if(message&&!regenerate){
    const key=currentAutoReplyContext(state,message);
    if(!key||!message.aiReplyContextHash||!canSendAutoReply(state.settings,state.messages,message,message.aiReplyInboundId))return false;
    if(await hashAiReplyContext(key)!==message.aiReplyContextHash)return false;
    const fresh=useAppStore.getState(),current=fresh.messages.find(item=>item.id===message.id);
    if(!current||current.deliveryStatus!=="failed"||current.deliveryUncertain||currentAutoReplyContext(fresh,current)!==key||!canSendAutoReply(fresh.settings,fresh.messages,current,current.aiReplyInboundId))return false;
    fresh.updateMessageDelivery(current.id,{deliveryStatus:"queued",retryCount:0,nextAttemptAt:new Date().toISOString(),lastError:undefined});
    return true;
  }
  const thread=state.messagesByChatId?.[chatId]||state.messages.filter(item=>item.chatId===chatId);
  const latest=thread.filter(item=>item.direction==="in").at(-1);
  const targetId=inboundId||message?.aiReplyInboundId||thread.filter(item=>item.direction==="in"&&message&&item.sentAt<=message.sentAt).at(-1)?.id;
  if(!latest||latest.id!==targetId||!canScheduleAutoReply(latest))return false;
  stopAutoReplyTask(chatId,targetId,messageId);
  const current=useAppStore.getState();
  current.updateSettings({aiTaskDismissedIds:(current.settings.aiTaskDismissedIds||[]).filter(key=>key!==`runtime:${chatId}:${targetId}`)});
  await autoReplyInbound(latest);
  return true;
}

export function refreshManualTakeovers(): void {
  for (const { message, timer } of [...takeoverWaits.values()]) {
    clearTimeout(timer);
    takeoverWaits.delete(message.chatId);
    void autoReplyInbound(message);
  }
}

function waitForManualTakeover(message: Message, retryAt: number, reason: string): void {
  const previous = takeoverWaits.get(message.chatId);
  if (previous) clearTimeout(previous.timer);
  takeoverWaits.set(message.chatId, { message, timer: setTimeout(() => {
    takeoverWaits.delete(message.chatId);
    void autoReplyInbound(message);
  }, Math.max(1, retryAt - Date.now())) });
  setAutoReplyRuntime(message.chatId, { phase: "waiting", inboundId: message.id,
    accountId: message.accountId, reason, retryAt });
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
  if(useAppStore.getState().settings.aiAutoReplyPaused){holdPausedReply(m);return;}
  if (!canScheduleAutoReply(m)) { setAutoReplyRuntime(m.chatId,null,m.id);return; }
  if (useAppStore.getState().settings.aiTaskDismissedIds?.includes(`runtime:${m.chatId}:${m.id}`)) return;
  const active = activeRequests.get(m.chatId);
  if (active && !active.controller.signal.aborted && (active.id === m.id || active.sentAt > m.sentAt)) return;
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
      if(useAppStore.getState().settings.aiAutoReplyPaused){holdPausedReply(next);break;}
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
        setAutoReplyRuntime(m.chatId,{phase:"waiting",inboundId:next.id,accountId:next.accountId,reason:"等待发送间隔",retryAt:Date.now()+wait});
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
      if (!controller.signal.aborted && runtime?.inboundId === next.id && runtime.phase !== "human" && !takeoverWaits.has(m.chatId)) setAutoReplyRuntime(m.chatId, null, next.id);
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
    if (m.contactId) {
      const detail = scope.source === "folder"
        ? `来自文件夹「${scope.folderName}」`
        : scope.source === "chat"
          ? "该会话已单独设置为只人工处理"
          : scope.source === "paused"
            ? "全局自动回复已暂停"
            : "默认回复模式为仅人工；检查全局或文件夹回复模式";
      logAutoSkipOnce(m.chatId, m.contactId, `scope:${scope.source}:${scope.mode}`, "自动回复：仅人工", detail);
    }
    return;
  }
  if (m.isGroup) return; // 仅私聊
  if (!m.chatId || !m.contactId) return;
  let conversation = state.messagesByChatId?.[m.chatId] || state.messages.filter(x => x.chatId === m.chatId).sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  if (conversation.filter(x => x.direction === "in").at(-1)?.id !== m.id ||
      conversation.some(x => x.direction === "out" && !x.systemKind && x.sentAt >= m.sentAt) ||
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
      runtime("waiting", "WhatsApp 账号未连接");
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
      runtime("waiting", "手机桥接未连接");
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
    runtime("human", "未配置 AI 服务");
    return;
  }

  const policy = resolveAutoReplyPolicy(settings.aiAutoReplyPolicy, settings.aiAutoReplyPolicyByAccountId, accountId);
  const beforeVoice = evaluateAutoReplyDecision(conversation, m, Date.now(), policy);
  if (!beforeVoice.allow && (beforeVoice.kind !== "risk" || !isVoiceMessage(m) || !!m.transcript?.trim())) {
    logAutoSkipOnce(m.chatId, contact.id, `decision:${beforeVoice.kind}`, "自动回复：暂停", beforeVoice.reason);
    if (beforeVoice.kind === "manual_takeover" && beforeVoice.retryAt) waitForManualTakeover(m, beforeVoice.retryAt, beforeVoice.reason);
    else runtime("human",beforeVoice.reason);
    return;
  }
  const lastOut = conversation.map(x => x.direction === "out" && !["pending", "queued", "failed", "local"].includes(x.deliveryStatus || "")).lastIndexOf(true);
  const unansweredVoices = conversation.slice(lastOut + 1).filter(x => x.direction === "in" && isVoiceMessage(x));
  const voices = unansweredVoices.filter(x => !x.transcript?.trim());
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
    if (!current?.mediaUrl) { runtime("waiting", current?.mediaError || "语音文件尚未加载，稍后重试"); return "retry"; }
    const { transcribeVoice } = await import("@/lib/transcribeVoice");
    const result = await abortable(transcribeVoice(current.mediaUrl, current.mediaMime || "audio/ogg", settings, { signal, language: "" }), signal);
    if (signal.aborted || !useAppStore.getState().messages.some(x => x.id === voice.id && x.chatId === m.chatId)) return;
    if (result.fallback || result.error || !result.text.trim()) {
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
  const pendingVoiceIds = new Set(unansweredVoices.map(x => x.id));
  const decision = conversation.filter(x => x.id === m.id || pendingVoiceIds.has(x.id))
    .map(inbound => evaluateAutoReplyDecision(conversation, inbound, Date.now(), policy)).find(item => !item.allow)
    || evaluateAutoReplyDecision(conversation, m, Date.now(), policy);
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
    if (decision.kind === "manual_takeover" && decision.retryAt) waitForManualTakeover(m, decision.retryAt, decision.reason);
    else runtime("human",decision.reason);
    return;
  }
  const contextKey = getSuggestionContextKey(contact, conversation, settings, accountId, { auto: true });
  if (isManualSuggestionContext(getSuggestionContextKey(contact, conversation, settings, accountId))) {runtime("human","当前消息需要人工处理");return;}
  runtime("generating");
  const generationStartedAt = Date.now();
  const result = await generateSuggestions(contact, conversation, settings, {
    auto: true,
    accountId,
    signal,
    onMuseQueue:running=>{if(!signal.aborted)runtime(running?"generating":"waiting",running?"Muse 正在生成":"等待 Muse 排队");},
  });
  if (signal.aborted) return;
  if (Date.now() < generationStartedAt || Date.now() - generationStartedAt >= SUGGESTION_MAX_AGE_MS) {
    runtime("human", "生成的回复已过期，请重新生成");
    return;
  }
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
    validUntil: generationStartedAt + SUGGESTION_MAX_AGE_MS,
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
  validUntil?: number;
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
  if (opts.validUntil && Date.now() >= opts.validUntil) return false;
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
    aiReplyInboundId: opts.inboundId,
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
      if (opts.validUntil && Date.now() >= opts.validUntil) return false;
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
