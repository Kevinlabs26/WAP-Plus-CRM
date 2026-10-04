import { isValidAccountId } from "@/types/account";
import type {
  Activity,
  ChatPreview,
  Contact,
  FollowUp,
  Message,
  PhoneDevice,
} from "@/types/crm";
import type { AppSettings } from "@/store/appStore";
import type { WaAccount } from "@/types/account";
import type { BroadcastCampaign } from "@/types/broadcast";
import { normalizeCampaigns } from "@/lib/broadcastCampaign";

/** v2：可恢复；settingsSafe 含多号槽但不含 API Key */
export type ExportBundleV2 = {
  version: 2;
  exportedAt: string;
  app: "WAP Plus CRM";
  phones: PhoneDevice[];
  contacts: Contact[];
  chats: ChatPreview[];
  messages: Message[];
  followUps: FollowUp[];
  activities: Activity[];
  broadcastCampaigns: BroadcastCampaign[];
  settingsSafe: SettingsSafeExport;
};

/** 旧版 v1 兼容 */
export type ExportBundleV1 = {
  version: 1;
  exportedAt: string;
  phones: PhoneDevice[];
  contacts: Contact[];
  chats: ChatPreview[];
  messages: Message[];
  followUps: FollowUp[];
  activities: Activity[];
  settingsPublic: Pick<
    AppSettings,
    "bridgeHost" | "bridgePort" | "aiProvider" | "ollamaUrl"
  >;
};

export type ExportBundle = ExportBundleV1 | ExportBundleV2;

export type SettingsSafeExport = {
  bridgeHost: string;
  bridgePort: number;
  aiProvider: AppSettings["aiProvider"];
  aiModel: string;
  ollamaUrl: string;
  /** 自定义 OpenAI 兼容端点（非敏感，恢复后免重填） */
  customAiBaseUrl: string;
  customAiModel: string;
  sendChannel: AppSettings["sendChannel"];
  rateLimitEnabled: boolean;
  ratePerMinute: number;
  ratePerHour: number;
  rateMinIntervalSec: number;
  quickReplies: AppSettings["quickReplies"];
  quickReplyCustomCategories: AppSettings["quickReplyCustomCategories"];
  translateTargetLang: string;
  myLang: string;
  voiceInputEngine: AppSettings["voiceInputEngine"];
  voiceInputLang: string;
  leadInbox: AppSettings["leadInbox"];
  chatFolders: AppSettings["chatFolders"];
  chatFolderClones: AppSettings["chatFolderClones"];
  scheduledMessages: AppSettings["scheduledMessages"];
  /** 账号槽：去掉大体量 data: 头像，恢复后可重拉 */
  waAccounts: WaAccount[];
  activeAccountId: string;
  liveBaileysAccountId: string;
  accountViewMode: AppSettings["accountViewMode"];
  lockSendToActiveAccount: boolean;
  blocklistJids: string[];
  blocklistByAccountId: Record<string, string[]>;
  historySyncNote?: string;
  historySyncNoteByAccountId: Record<string, string>;
  internalNotesByKey: Record<string, string>;
  autoFollowUpEnabled: boolean;
  followUpRuleSettings: AppSettings["followUpRuleSettings"];
  /** AI 回复模式与人设（此前导出丢失，跨机恢复后全部回落默认） */
  aiReplyMode: AppSettings["aiReplyMode"];
  aiAutoReplyIntervalMs: number;
  aiAutoReplyPolicy: AppSettings["aiAutoReplyPolicy"];
  aiAutoReplyPolicyByAccountId: AppSettings["aiAutoReplyPolicyByAccountId"];
  aiSystemPrompt: string;
  aiSystemPromptByAccountId: Record<string, string>;
  translateService: AppSettings["translateService"];
  notifyFollowUpEnabled: boolean;
  notifyGroupMessagesEnabled: boolean;
  autoReadGroupMessages: boolean;
  chatBackground?: AppSettings["chatBackground"];
  blockSendWhenOverheated: boolean;
  sendPausedAccountIds: string[];
  rateJitterSec: number;
  globalMinGapSec: number;
  personPrimaryAccountByKey: Record<string, string>;
  desktopNotifyEnabled: boolean;
  salesStageLabels: AppSettings["salesStageLabels"];
  salesStageOrder: AppSettings["salesStageOrder"];
  autoConnectBridge: boolean;
  theme: AppSettings["theme"];
};

const HEAVY_AVATAR = 12_000;

function stripAccountAvatars(accounts: WaAccount[]): WaAccount[] {
  return (accounts || []).map((a) => {
    const url = a.avatarUrl || "";
    if (url.startsWith("data:") && url.length > HEAVY_AVATAR) {
      const { avatarUrl: _drop, ...rest } = a;
      return rest;
    }
    return a;
  });
}

export function buildSettingsSafe(settings: AppSettings): SettingsSafeExport {
  return {
    bridgeHost: settings.bridgeHost,
    bridgePort: settings.bridgePort,
    aiProvider: settings.aiProvider,
    aiModel: settings.aiModel,
    ollamaUrl: settings.ollamaUrl,
    customAiBaseUrl: settings.customAiBaseUrl || "",
    customAiModel: settings.customAiModel || "",
    sendChannel: settings.sendChannel,
    rateLimitEnabled: settings.rateLimitEnabled !== false,
    ratePerMinute: settings.ratePerMinute,
    ratePerHour: settings.ratePerHour,
    rateMinIntervalSec: settings.rateMinIntervalSec,
    quickReplies: settings.quickReplies,
    quickReplyCustomCategories: settings.quickReplyCustomCategories || [],
    translateTargetLang: settings.translateTargetLang,
    myLang: settings.myLang,
    voiceInputEngine: settings.voiceInputEngine,
    voiceInputLang: settings.voiceInputLang,
    leadInbox: settings.leadInbox,
    chatFolders: settings.chatFolders,
    chatFolderClones: settings.chatFolderClones,
    scheduledMessages: settings.scheduledMessages || [],
    waAccounts: stripAccountAvatars(settings.waAccounts || []),
    activeAccountId: settings.activeAccountId,
    liveBaileysAccountId: settings.liveBaileysAccountId,
    accountViewMode: settings.accountViewMode,
    lockSendToActiveAccount: settings.lockSendToActiveAccount,
    blocklistJids: settings.blocklistJids || [],
    blocklistByAccountId: settings.blocklistByAccountId || {},
    historySyncNote: settings.historySyncNote,
    historySyncNoteByAccountId: settings.historySyncNoteByAccountId || {},
    internalNotesByKey: settings.internalNotesByKey || {},
    autoFollowUpEnabled: settings.autoFollowUpEnabled !== false,
    followUpRuleSettings: settings.followUpRuleSettings,
    aiReplyMode: settings.aiReplyMode,
    aiAutoReplyIntervalMs: settings.aiAutoReplyIntervalMs,
    aiAutoReplyPolicy: settings.aiAutoReplyPolicy,
    aiAutoReplyPolicyByAccountId: settings.aiAutoReplyPolicyByAccountId || {},
    aiSystemPrompt: settings.aiSystemPrompt || "",
    aiSystemPromptByAccountId: settings.aiSystemPromptByAccountId || {},
    translateService: settings.translateService,
    notifyFollowUpEnabled: settings.notifyFollowUpEnabled !== false,
    notifyGroupMessagesEnabled: settings.notifyGroupMessagesEnabled === true,
    autoReadGroupMessages: settings.autoReadGroupMessages === true,
    chatBackground: settings.chatBackground,
    blockSendWhenOverheated: settings.blockSendWhenOverheated !== false,
    sendPausedAccountIds: settings.sendPausedAccountIds || [],
    rateJitterSec: settings.rateJitterSec ?? 2,
    globalMinGapSec: settings.globalMinGapSec ?? 2,
    personPrimaryAccountByKey: settings.personPrimaryAccountByKey || {},
    desktopNotifyEnabled: settings.desktopNotifyEnabled !== false,
    salesStageLabels: settings.salesStageLabels || {},
    salesStageOrder: settings.salesStageOrder || [],
    autoConnectBridge: settings.autoConnectBridge !== false,
    theme: settings.theme,
  };
}

export function buildExportBundle(input: {
  phones: PhoneDevice[];
  contacts: Contact[];
  chats: ChatPreview[];
  messages: Message[];
  followUps: FollowUp[];
  activities: Activity[];
  broadcastCampaigns: BroadcastCampaign[];
  settings: AppSettings;
  includeMedia?: boolean;
}): ExportBundleV2 {
  // 导出时剥离消息里过大的 inline media，减小文件
  const messages = input.messages.map((m) => {
    const url = m.mediaUrl || "";
    if (!input.includeMedia && url.startsWith("data:") && url.length > 8_000) {
      return {
        ...m,
        mediaUrl: undefined,
        mediaPending: m.mediaType ? true : m.mediaPending,
      };
    }
    return m;
  });
  return {
    version: 2,
    app: "WAP Plus CRM",
    exportedAt: new Date().toISOString(),
    phones: input.phones,
    contacts: input.contacts,
    chats: input.chats,
    messages,
    followUps: input.followUps,
    activities: input.activities,
    broadcastCampaigns: input.broadcastCampaigns,
    settingsSafe: buildSettingsSafe(input.settings),
  };
}

export type ParsedBackup = {
  phones: PhoneDevice[];
  contacts: Contact[];
  chats: ChatPreview[];
  messages: Message[];
  followUps: FollowUp[];
  activities: Activity[];
  broadcastCampaigns: BroadcastCampaign[];
  settingsSafe: Partial<SettingsSafeExport> | null;
  version: number;
  exportedAt?: string;
};

/** 导入时允许的媒体 URL 协议，降低恶意备份风险 */
export function sanitizeMediaUrl(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  const u = url.trim();
  if (!u || u.length > 24 * 1024 * 1024) return undefined;
  if (/^https:\/\//i.test(u)) return u;
  if (/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(u)) return u;
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(u)) return u;
  if (/^data:audio\/[a-z0-9.+-]+;base64,/i.test(u)) return u;
  if (/^data:video\/[a-z0-9.+-]+;base64,/i.test(u)) return u;
  if (/^data:application\/[a-z0-9.+-]+;base64,/i.test(u)) return u;
  if (/^blob:/i.test(u)) return undefined; // blob 不可跨会话恢复
  return undefined;
}

function str(v: unknown, max = 2000): string {
  if (v == null) return "";
  return String(v).slice(0, max);
}

function sanitizeContact(raw: unknown): Contact | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const id = str(c.id, 120);
  if (!id) return null;
  const stageRaw = str(c.stage, 40);
  const stage = (
    /^[a-z][a-z0-9_-]{0,39}$/i.test(stageRaw)
      ? stageRaw
      : "new"
  ) as Contact["stage"];
  const tags = Array.isArray(c.tags)
    ? c.tags.map((t) => str(t, 80)).filter(Boolean).slice(0, 40)
    : [];
  return {
    id,
    name: str(c.name, 200) || "未命名",
    phone: str(c.phone, 40),
    accountId: str(c.accountId, 80) || undefined,
    personKey: str(c.personKey, 120) || undefined,
    channelAddress: str(c.channelAddress, 200) || undefined,
    country: str(c.country, 80) || undefined,
    company: str(c.company, 200) || undefined,
    source: str(c.source, 120) || undefined,
    owner: str(c.owner, 120) || undefined,
    tags,
    stage,
    notes: str(c.notes, 8000) || undefined,
    aiSummary: str(c.aiSummary, 4000) || undefined,
    aiIntent: str(c.aiIntent, 800) || undefined,
    aiNextStep: str(c.aiNextStep, 800) || undefined,
    aiSuggestedStage: (() => {
      const value = str(c.aiSuggestedStage, 40);
      return /^[a-z][a-z0-9_-]{0,39}$/i.test(value)
        ? (value as Contact["aiSuggestedStage"])
        : undefined;
    })(),
    aiInsightAt: str(c.aiInsightAt, 40) || undefined,
    boundPhoneId: str(c.boundPhoneId, 80) || undefined,
    lastMessageAt: str(c.lastMessageAt, 40) || undefined,
    nextFollowUpAt: str(c.nextFollowUpAt, 40) || undefined,
    avatarUrl: sanitizeMediaUrl(c.avatarUrl) || undefined,
    avatarFullUrl: sanitizeMediaUrl(c.avatarFullUrl) || undefined,
    preferredLang: str(c.preferredLang, 16) || undefined,
    // 联系人检测语言此前被静默丢弃，恢复后回退默认目标语言
    language: str(c.language, 16) || undefined,
    isGroup: Boolean(c.isGroup) || undefined,
    participantCount:
      typeof c.participantCount === "number"
        ? Math.max(0, Math.round(c.participantCount))
        : undefined,
    groupOwner: str(c.groupOwner, 200) || undefined,
    groupDesc: str(c.groupDesc, 4000) || undefined,
    groupAnnounce: Boolean(c.groupAnnounce) || undefined,
    groupRestrict: Boolean(c.groupRestrict) || undefined,
    groupEphemeral:
      typeof c.groupEphemeral === "number"
        ? Math.max(0, Math.round(c.groupEphemeral))
        : undefined,
    groupJoinApproval: Boolean(c.groupJoinApproval) || undefined,
    groupLinkedParent: str(c.groupLinkedParent, 200) || undefined,
    groupIsCommunity: Boolean(c.groupIsCommunity) || undefined,
  };
}

function sanitizeChat(raw: unknown): ChatPreview | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const id = str(c.id, 200);
  const contactId = str(c.contactId, 120);
  if (!id || !contactId) return null;
  return {
    id,
    contactId,
    contactName: str(c.contactName, 200) || contactId,
    lastMessage: str(c.lastMessage, 2000),
    unread: Math.max(0, Math.min(99999, Number(c.unread) || 0)),
    updatedAt: str(c.updatedAt, 40) || new Date().toISOString(),
    replyHandledAt: typeof c.replyHandledAt === "string" && Number.isFinite(Date.parse(c.replyHandledAt))
      ? new Date(c.replyHandledAt).toISOString() : undefined,
    replyPendingSince: c.replyPendingSince === "" ? ""
      : typeof c.replyPendingSince === "string" && Number.isFinite(Date.parse(c.replyPendingSince))
        ? new Date(c.replyPendingSince).toISOString() : undefined,
    phoneId: str(c.phoneId, 80) || "",
    accountId: str(c.accountId, 80) || undefined,
    archived: Boolean(c.archived) || undefined,
    pinned: Boolean(c.pinned) || undefined,
    mutedUntil:
      typeof c.mutedUntil === "number" && Number.isFinite(c.mutedUntil)
        ? c.mutedUntil
        : undefined,
    isGroup: Boolean(c.isGroup) || undefined,
    localOnly: Boolean(c.localOnly) || undefined,
  };
}

function sanitizeMessage(raw: unknown): Message | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const id = str(m.id, 120);
  const chatId = str(m.chatId, 200);
  if (!id || !chatId) return null;
  const dir = m.direction === "in" || m.direction === "out" ? m.direction : "in";
  const mediaUrl = sanitizeMediaUrl(m.mediaUrl);
  const mediaThumbUrl = sanitizeMediaUrl(m.mediaThumbUrl);
  return {
    id,
    chatId,
    direction: dir,
    body: str(m.body, 20000),
    sentAt: str(m.sentAt, 40) || new Date().toISOString(),
    accountId: str(m.accountId, 80) || undefined,
    deliveryStatus:
      typeof m.deliveryStatus === "string"
        ? (str(m.deliveryStatus, 40) as Message["deliveryStatus"])
        : undefined,
    lastError: str(m.lastError, 400) || undefined,
    deliveryUncertain: typeof m.deliveryUncertain === "boolean" ? m.deliveryUncertain : undefined,
    retryCount:
      typeof m.retryCount === "number" && Number.isFinite(m.retryCount)
        ? Math.max(0, Math.min(99, Math.round(m.retryCount)))
        : undefined,
    nextAttemptAt: str(m.nextAttemptAt, 40) || undefined,
    phoneE164: str(m.phoneE164, 40) || undefined,
    contactId: str(m.contactId, 120) || undefined,
    channelId: str(m.channelId, 40) || undefined,
    deviceId:
      m.deviceId === null ? null : str(m.deviceId, 80) || undefined,
    isGroup: Boolean(m.isGroup) || undefined,
    groupJid: str(m.groupJid, 200) || undefined,
    senderJid: str(m.senderJid, 200) || undefined,
    senderPhoneE164: str(m.senderPhoneE164, 40) || undefined,
    senderName: str(m.senderName, 200) || undefined,
    senderAvatarUrl: sanitizeMediaUrl(m.senderAvatarUrl) || undefined,
    systemKind: str(m.systemKind, 80) || undefined,
    systemAction: str(m.systemAction, 80) || undefined,
    mentionedJids: Array.isArray(m.mentionedJids)
      ? m.mentionedJids
          .map((jid) => str(jid, 200))
          .filter(Boolean)
          .slice(0, 100)
      : undefined,
    mentionedMe: Boolean(m.mentionedMe) || undefined,
    waMessageId: str(m.waMessageId, 120) || undefined,
    waKey: (() => {
      if (!m.waKey || typeof m.waKey !== "object") return undefined;
      const key = m.waKey as Record<string, unknown>;
      const remoteJid = str(key.remoteJid, 200);
      const keyId = str(key.id, 120);
      if (!remoteJid || !keyId) return undefined;
      return {
        remoteJid,
        id: keyId,
        fromMe: Boolean(key.fromMe),
        participant: str(key.participant, 200) || undefined,
      };
    })(),
    mediaType: str(m.mediaType, 40) || undefined,
    transcript: str(m.transcript, 20000) || undefined,
    // 备份恢复必须保真：译文缓存、媒体错误、名片 vCard 此前被静默丢弃
    translation: str(m.translation, 20000) || undefined,
    translationLang: str(m.translationLang, 20) || undefined,
    mediaError: str(m.mediaError, 400) || undefined,
    contactCard: (() => {
      if (!m.contactCard || typeof m.contactCard !== "object") return undefined;
      const card = m.contactCard as Record<string, unknown>;
      const displayName = str(card.displayName, 200);
      const phone = str(card.phoneE164, 40);
      if (!displayName || !phone) return undefined;
      return {
        displayName,
        phoneE164: phone,
        vcard: str(card.vcard, 40000) || undefined,
      };
    })(),
    mediaUrl,
    mediaMime: str(m.mediaMime, 120) || undefined,
    mediaFileName: str(m.mediaFileName, 240) || undefined,
    mediaSeconds:
      typeof m.mediaSeconds === "number" && Number.isFinite(m.mediaSeconds)
        ? Math.max(0, Math.min(7200, m.mediaSeconds))
        : undefined,
    mediaPtt: Boolean(m.mediaPtt) || undefined,
    mediaCaption: str(m.mediaCaption, 4000) || undefined,
    mediaThumbUrl,
    mediaPending: Boolean(m.mediaPending) || undefined,
    reactions: Array.isArray(m.reactions)
      ? m.reactions
          .map((rawReaction) => {
            if (!rawReaction || typeof rawReaction !== "object") return null;
            const reaction = rawReaction as Record<string, unknown>;
            const emoji = str(reaction.emoji, 32);
            const from = str(reaction.from, 16);
            if (!emoji || !["me", "peer", "member"].includes(from)) return null;
            return {
              emoji,
              from: from as "me" | "peer" | "member",
              participantJid: str(reaction.participantJid, 200) || undefined,
              participantName: str(reaction.participantName, 200) || undefined,
              at: str(reaction.at, 40) || undefined,
            };
          })
          .filter((reaction): reaction is NonNullable<typeof reaction> => Boolean(reaction))
          .slice(0, 200)
      : undefined,
    quoted: (() => {
      if (!m.quoted || typeof m.quoted !== "object") return undefined;
      const quoted = m.quoted as Record<string, unknown>;
      const quotedId = str(quoted.id, 120);
      if (!quotedId) return undefined;
      return {
        id: quotedId,
        body: str(quoted.body, 20000),
        fromMe: Boolean(quoted.fromMe) || undefined,
        remoteJid: str(quoted.remoteJid, 200) || undefined,
        participant: str(quoted.participant, 200) || undefined,
        senderName: str(quoted.senderName, 200) || undefined,
        mediaType: str(quoted.mediaType, 40) || undefined,
        mediaSeconds:
          typeof quoted.mediaSeconds === "number"
            ? Math.max(0, Math.min(86_400, quoted.mediaSeconds))
            : undefined,
      };
    })(),
    starred: Boolean(m.starred) || undefined,
    starredAt: str(m.starredAt, 40) || undefined,
    savedFromMessageId: str(m.savedFromMessageId, 120) || undefined,
    savedFromContactId: str(m.savedFromContactId, 120) || undefined,
    savedFromContactName: str(m.savedFromContactName, 200) || undefined,
    savedFromChatName: str(m.savedFromChatName, 200) || undefined,
    savedFromSentAt: str(m.savedFromSentAt, 40) || undefined,
    savedPinned: Boolean(m.savedPinned) || undefined,
    savedTags: Array.isArray(m.savedTags)
      ? m.savedTags.map((tag) => str(tag, 40)).filter(Boolean).slice(0, 8)
      : undefined,
    edited: Boolean(m.edited) || undefined,
  };
}

function sanitizePhone(raw: unknown): PhoneDevice | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const id = str(p.id, 80);
  if (!id) return null;
  return {
    id,
    name: str(p.name, 120) || id,
    model: str(p.model, 120),
    remark: str(p.remark, 200),
    online: Boolean(p.online),
    battery: Math.max(0, Math.min(100, Number(p.battery) || 0)),
    charging: Boolean(p.charging) || undefined,
    whatsappInstalled: Boolean(p.whatsappInstalled) || undefined,
    accessibilityEnabled: Boolean(p.accessibilityEnabled) || undefined,
    overlayEnabled: Boolean(p.overlayEnabled) || undefined,
    boundRegion: str(p.boundRegion, 80) || undefined,
  };
}

function sanitizeFollowUp(raw: unknown): FollowUp | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  const id = str(f.id, 120);
  const contactId = str(f.contactId, 120);
  if (!id || !contactId) return null;
  return {
    id,
    contactId,
    contactName: str(f.contactName, 200),
    dueAt: str(f.dueAt, 40),
    note: str(f.note, 2000) || undefined,
    done: Boolean(f.done) || f.cancelled === true,
    cancelled: f.cancelled === true ? true : undefined,
  };
}

function sanitizeActivity(raw: unknown): Activity | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const id = str(a.id, 120);
  const contactId = str(a.contactId, 120);
  if (!id || !contactId) return null;
  return {
    id,
    contactId,
    kind: (str(a.kind, 40) || "system") as Activity["kind"],
    title: str(a.title, 200) || "活动",
    detail: str(a.detail, 2000) || undefined,
    at: str(a.at, 40) || new Date().toISOString(),
  };
}

export function parseBackupJson(raw: unknown): ParsedBackup {
  if (!raw || typeof raw !== "object") {
    throw new Error("备份文件格式无效");
  }
  const o = raw as Record<string, unknown>;
  const settingsInput = o.settingsSafe ?? o.settingsPublic;
  const accounts = settingsInput && typeof settingsInput === "object"
    ? (settingsInput as Record<string, unknown>).waAccounts : undefined;
  if (Array.isArray(accounts)) {
    const ids = new Set<string>();
    for (const account of accounts) {
      const id = account && typeof account === "object" ? account.id : undefined;
      if (!isValidAccountId(id) || ids.has(id)) throw new Error("备份含无效或重复的账号 ID，请先修正账号槽位");
      ids.add(id);
    }
  }
  for (const key of ["contacts", "chats", "messages"]) {
    if (!Array.isArray(o[key])) continue;
    for (const item of o[key] as unknown[]) {
      if (!item || typeof item !== "object") continue;
      const id = (item as Record<string, unknown>).accountId;
      if (id != null && id !== "" && !isValidAccountId(id)) throw new Error("备份含无效账号归属 ID");
    }
  }
  const version = Number(o.version) || 1;
  const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

  const phones = asArr(o.phones)
    .map(sanitizePhone)
    .filter((x): x is PhoneDevice => Boolean(x));
  const contacts = asArr(o.contacts)
    .map(sanitizeContact)
    .filter((x): x is Contact => Boolean(x));
  const chats = asArr(o.chats)
    .map(sanitizeChat)
    .filter((x): x is ChatPreview => Boolean(x));
  const messages = asArr(o.messages)
    .map(sanitizeMessage)
    .filter((x): x is Message => Boolean(x))
    .map((message) => {
      const unfinished =
        message.direction === "out" &&
        (message.deliveryStatus === "pending" ||
          message.deliveryStatus === "queued" ||
          (message.deliveryStatus === "failed" &&
            (message.retryCount ?? 0) < 5));
      return unfinished
        ? {
            ...message,
            deliveryStatus: "failed" as const,
            retryCount: 5,
            nextAttemptAt: undefined,
            lastError: "从备份恢复，未自动重发",
          }
        : message;
    });
  const mediaChars = messages.reduce((sum, message) => sum +
    (message.mediaUrl?.startsWith("data:") ? message.mediaUrl.length : 0), 0);
  if (mediaChars > 128 * 1024 * 1024) throw new Error("备份附件总量超过 128 MB");
  const followUps = asArr(o.followUps)
    .map(sanitizeFollowUp)
    .filter((x): x is FollowUp => Boolean(x));
  const activities = asArr(o.activities)
    .map(sanitizeActivity)
    .filter((x): x is Activity => Boolean(x));
  const broadcastCampaigns = normalizeCampaigns(o.broadcastCampaigns);

  if (!contacts.length && !chats.length && !messages.length && !phones.length) {
    throw new Error("备份里没有可恢复的客户/会话/消息数据");
  }

  let settingsSafe: Partial<SettingsSafeExport> | null = null;
  if (o.settingsSafe && typeof o.settingsSafe === "object") {
    settingsSafe = o.settingsSafe as Partial<SettingsSafeExport>;
  } else if (o.settingsPublic && typeof o.settingsPublic === "object") {
    settingsSafe = o.settingsPublic as Partial<SettingsSafeExport>;
  }
  // 只恢复客户数据与界面偏好；端点、密钥、自动发送及保护策略沿用本机。
  if (settingsSafe) {
    const allowed = [
      "quickReplies", "quickReplyCustomCategories", "translateTargetLang", "myLang",
      "voiceInputLang", "leadInbox", "chatFolders", "chatFolderClones",
      "scheduledMessages", "waAccounts", "accountViewMode", "historySyncNote",
      "historySyncNoteByAccountId", "internalNotesByKey", "chatBackground",
      "salesStageLabels", "salesStageOrder", "theme",
    ];
    settingsSafe = Object.fromEntries(
      allowed.filter((key) => Object.hasOwn(settingsSafe!, key))
        .map((key) => [key, (settingsSafe as Record<string, unknown>)[key]])
    ) as Partial<SettingsSafeExport>;
    if (Array.isArray(settingsSafe.scheduledMessages)) {
      settingsSafe.scheduledMessages = settingsSafe.scheduledMessages.map((task) =>
        task && (task.status === "pending" || task.status === "queued")
          ? { ...task, status: "failed", messageId: undefined, error: "从备份恢复：请重新确认发送时间" }
          : task
      );
    }
  }

  return {
    phones,
    contacts,
    chats,
    messages,
    followUps,
    activities,
    broadcastCampaigns,
    settingsSafe,
    version,
    exportedAt:
      typeof o.exportedAt === "string" ? o.exportedAt : undefined,
  };
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** 简易 CSV（联系人） */
export function contactsToCsv(contacts: Contact[]): string {
  const header = [
    "id",
    "name",
    "phone",
    "country",
    "company",
    "source",
    "owner",
    "stage",
    "tags",
    "boundPhoneId",
    "accountId",
    "nextFollowUpAt",
    "notes",
  ];
  // 表格软件不能把客户输入当公式；手机号按文本保留前导零。
  const esc = (v: string, phone = false) => {
    if (phone || /^[\s\u0000-\u001f]*[=+\-@＝＋－＠]/u.test(v) || /^[\t\r\n]/.test(v)) v = "'" + v;
    return `"${v.replace(/"/g, '""')}"`;
  };
  const rows = contacts.map((c) =>
    [
      c.id,
      c.name,
      c.phone,
      c.country ?? "",
      c.company ?? "",
      c.source ?? "",
      c.owner ?? "",
      c.stage,
      (c.tags || []).join("|"),
      c.boundPhoneId ?? "",
      c.accountId ?? "",
      c.nextFollowUpAt ?? "",
      c.notes ?? "",
    ]
      .map((x, index) => esc(String(x), index === 2))
      .join(",")
  );
  return [header.join(","), ...rows].join("\n");
}

export function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function readJsonFile(file: File): Promise<unknown> {
  if (file.size > 256 * 1024 * 1024) throw new Error("备份文件超过 256 MB，请拆分附件后重试");
  const text = await file.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("无法解析 JSON 文件");
  }
}
