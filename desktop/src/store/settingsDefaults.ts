import {
  normalizeQuickReplyCategory,
  type QuickReplyCategory,
} from "@/lib/quickReplies";

export interface SettingsQuickReply {
  id: string;
  title: string;
  body: string;
  category: QuickReplyCategory;
}

import type { AccountViewMode, FolderScope, WaAccount } from "@/types/account";
import type { ScheduledMessage, SalesStage } from "@/types/crm";
import {
  ensureAccounts,
  ensureActiveAccountId,
  parseViewMode,
  pruneGhostDefaultAccounts,
} from "@/lib/accounts";
import { dedupeAccountLabels } from "@/lib/accountLabels";
import { normalizeVoiceInputLanguage } from "@/lib/voiceInputLanguage";
import { DEFAULT_ACCOUNT_ID } from "@/types/account";
import {
  DEFAULT_FOLLOW_UP_RULE_SETTINGS,
  type FollowUpRuleSetting,
} from "@/lib/followUpRules";
import {
  DEFAULT_AUTO_REPLY_POLICY,
  normalizeAutoReplyPolicy,
  type AiAutoReplyPolicy,
} from "@/lib/aiSafety";

/** 侧栏会话分组（本地；一人主归属仅一组；按 scope 隔离） */
export interface SettingsChatFolder {
  id: string;
  name: string;
  /** 可选父分组；仅支持一层嵌套，避免侧栏树无限展开 */
  parentId?: string;
  sort: number;
  collapsed?: boolean;
  /** 主归属成员 chatId，在同一 scope 内互斥 */
  chatIds: string[];
  /**
   * 号内分组 or 全部视图跨号分组。
   * 缺省视为默认账号号内分组（兼容旧数据）。
   */
  scope?: FolderScope;
}

/**
 * 分身：同一会话额外出现在另一分组（打开仍是原会话）
 * 主归属不变；删除分身不影响主分组
 */
export interface SettingsChatFolderClone {
  id: string;
  folderId: string;
  sourceChatId: string;
}

export type LeadInboxDateGrouping = "none" | "day" | "week" | "month";
export type LeadInboxAccountScope = "view" | "all" | "selected";
export type LeadInboxSort = "first_contact" | "last_message" | "unread";

/** 主动联系智能夹子：只保存规则，成员由消息历史动态计算。 */
export interface LeadInboxSettings {
  enabled: boolean;
  includeGroups: boolean;
  dateGrouping: LeadInboxDateGrouping;
  /** 0 = 不限制；否则按首次主动联系时间向前取天数。 */
  dateRangeDays: number;
  accountScope: LeadInboxAccountScope;
  selectedAccountIds: string[];
  mergeAccounts: boolean;
  sort: LeadInboxSort;
  /** 回复后是否自动从主动联系视图移除；默认保留，方便继续跟进。 */
  removeAfterReply: boolean;
  /** 可选起始时间；为空时按现有消息历史识别。 */
  captureSince: string;
  /** 用户从智能夹子中手动移除的会话；不删除原会话和消息。 */
  dismissedChatIds: string[];
}

export function createDefaultLeadInboxSettings(): LeadInboxSettings {
  return {
    enabled: true,
    includeGroups: false,
    dateGrouping: "day",
    dateRangeDays: 0,
    accountScope: "view",
    selectedAccountIds: [],
    mergeAccounts: true,
    sort: "first_contact",
    removeAfterReply: false,
    captureSince: "",
    dismissedChatIds: [],
  };
}

export interface SettingsShape {
  openaiKey: string;
  groqKey: string;
  geminiKey: string;
  deepseekKey: string;
  qwenKey: string;
  zhipuKey: string;
  openrouterKey: string;
  ollamaUrl: string;
  bridgeHost: string;
  bridgePort: number;
  bridgeToken: string;
  aiProvider:
    | "mock"
    | "openai"
    | "groq"
    | "deepseek"
    | "qwen"
    | "zhipu"
    | "openrouter"
    | "gemini"
    | "ollama"
    | "custom";
  /** 自定义 OpenAI 兼容提供商 Base URL（如 https://api.deepseek.com/v1） */
  customAiBaseUrl: string;
  /** 自定义 OpenAI 兼容提供商 API Key */
  customAiKey: string;
  /** 自定义提供商聊天/翻译模型名 */
  customAiModel: string;
  /** 自定义提供商转写模型名（空 = 不支持转写） */
  customWhisperModel: string;
  /** 当前提供商选的模型（OpenAI / Groq / Gemini / Ollama 共用）；空 = 用提供商默认 */
  aiModel: string;
  /**
   * AI 回复模式：semi=只出建议（手动点发）；auto=自动回复入站私聊。
   * 自动模式按 aiSystemPrompt 适配身份与说话偏好。
   */
  aiReplyMode: "semi" | "auto";
  /** 自动回复防刷屏：同一会话两次自动回复的最小间隔（毫秒） */
  aiAutoReplyIntervalMs: number;
  /** 单独交给人工处理的会话 id；全局自动回复仍可保留 */
  aiAutoReplyManualChatIds: string[];
  /** 默认自动回复策略；各账号可以完整覆盖 */
  aiAutoReplyPolicy: AiAutoReplyPolicy;
  aiAutoReplyPolicyByAccountId: Record<string, AiAutoReplyPolicy>;
  /** 自定义聊天身份/背景/说话方式/边界（注入 system prompt） */
  aiSystemPrompt: string;
  /** WhatsApp 账号级身份覆盖；空值或无条目时继承 aiSystemPrompt */
  aiSystemPromptByAccountId: Record<string, string>;
  /**
   * 翻译服务：auto=有 AI Key 用 AI 否则 Google 免费；google=始终 Google 免费；ai=仅 AI（无 Key 演示占位）
   */
  translateService: "auto" | "google" | "ai";
  autoConnectBridge: boolean;
  sendChannel: "baileys" | "android_bridge";
  /** 是否启用分钟/小时/间隔限速；手动暂停与过热拦截独立 */
  rateLimitEnabled: boolean;
  ratePerMinute: number;
  ratePerHour: number;
  rateMinIntervalSec: number;
  quickReplies: SettingsQuickReply[];
  translateTargetLang: string;
  /** 我的语言（母语）：入站消息/语音翻译的译出目标（给自己看）。空 = 自动检测系统语言 */
  myLang: string;
  /**
   * 语音输入引擎（说话转文字）：
   * browser=浏览器实时识别；ai=录音后转写；auto=浏览器优先，不支持时降级 ai
   */
  voiceInputEngine: "browser" | "ai" | "auto";
  /** 说话语言；空值时 AI 自动检测，浏览器跟随系统语言。 */
  voiceInputLang: string;
  leadInbox: LeadInboxSettings;
  chatFolders: SettingsChatFolder[];
  chatFolderClones: SettingsChatFolderClone[];
  /** 已添加的 WA 账号槽（可多号） */
  waAccounts: WaAccount[];
  /** 当前操作/连接焦点账号 */
  activeAccountId: string;
  /**
   * 当前 Baileys 单 session 实际绑定的账号槽。
   * 与 activeAccountId 可不同：切浏览/加空槽不应把在线号资料写到新槽。
   */
  liveBaileysAccountId: string;
  /** 会话列表浏览：全部 or 单号 */
  accountViewMode: AccountViewMode;
  /**
   * true：强制用 activeAccountId 发送（高级）。
   * false（默认）：发送跟随会话 accountId。
   */
  lockSendToActiveAccount: boolean;
  /**
   * @deprecated 兼容旧数据；读写请用 blocklistByAccountId
   */
  blocklistJids: string[];
  /** 按账号槽的黑名单 jid */
  blocklistByAccountId: Record<string, string[]>;
  /**
   * @deprecated 兼容旧数据；读写请用 historySyncNoteByAccountId
   */
  historySyncNote?: string;
  /** 按账号槽的历史同步状态文案 */
  historySyncNoteByAccountId: Record<string, string>;
  /** 内部备注 chat:/contact: → 文本（客户不可见） */
  internalNotesByKey: Record<string, string>;
  /**
   * 自动跟进总开关 + 各规则超时（小时）。
   * 缺省 = 全开，用 followUpRules 默认小时数。
   */
  autoFollowUpEnabled: boolean;
  /** 各自动跟进规则（开关 + 小时） */
  followUpRuleSettings: FollowUpRuleSetting[];
  /** 一次性定时文字消息；由出站队列实际发送 */
  scheduledMessages: ScheduledMessage[];
  /** 健康度「过热」时是否拦截发送 */
  blockSendWhenOverheated: boolean;
  /** 监测页手动暂停发送的账号 id */
  sendPausedAccountIds: string[];
  /** 成功发送后额外随机间隔上限（秒），写入下次可发时间 */
  rateJitterSec: number;
  /** 跨账号成功发送最小间隔（秒），0=关闭 */
  globalMinGapSec: number;
  /** 撞单客户指定的跟进主号：personKey → accountId */
  personPrimaryAccountByKey: Record<string, string>;
  /** 系统通知总开关（新消息 / 跟进到期 / 入群申请 都受此控制） */
  desktopNotifyEnabled: boolean;
  /** 跟进到期是否单独弹系统通知 */
  notifyFollowUpEnabled: boolean;
  /** 群组消息是否单独弹系统通知 */
  notifyGroupMessagesEnabled: boolean;
  /** 自动已读群消息：新群消息到达且未在查看时，延迟自动清未读（清理手机侧群堆积） */
  autoReadGroupMessages: boolean;
  /** 群入群申请是否单独弹系统通知（兼容旧设置） */
  notifyGroupJoinEnabled: boolean;
  /**
   * CRM 看板阶段显示名（可点编辑）。
   * key 仍是内部 id：new / contacted / quoting / won / after_sales
   */
  salesStageLabels: Partial<Record<SalesStage, string>>;
  /** CRM 看板阶段顺序；可包含用户新增阶段 */
  salesStageOrder: SalesStage[];
  /** UI 主题：dark | light */
  theme: "dark" | "light";
  /** FluentChat 桌面界面语言；不影响联系人、分类和聊天内容 */
  uiLanguage: "zh-CN" | "en" | "fr";
  /** 聊天背景：无 / 纯色 / 图片 / 内建图案 */
  chatBackground?: {
    kind: "none" | "color" | "image" | "pattern";
    color?: string;
    /** 降采样后的 data URL（JPEG），体积可控可随设置持久化 */
    imageUrl?: string;
    /** 内建图案 id（见 lib/chatPatterns.ts） */
    patternId?: string;
  };
}

export const defaultQuickReplies: SettingsQuickReply[] = [
  {
    id: "qr-hello",
    title: "打招呼",
    body: "您好，我是这边负责对接的同事，有什么可以帮您？",
    category: "opening",
  },
  {
    id: "qr-quote",
    title: "索要需求",
    body: "方便发一下具体型号/数量/目的港吗？我帮您出报价。",
    category: "quote",
  },
  {
    id: "qr-follow",
    title: "跟进确认",
    body: "上次的方案您看了吗？有不清楚的地方我可以再说明。",
    category: "follow-up",
  },
];

export const defaultSettings: SettingsShape = {
  openaiKey: "",
  groqKey: "",
  geminiKey: "",
  deepseekKey: "",
  qwenKey: "",
  zhipuKey: "",
  openrouterKey: "",
  ollamaUrl: "http://127.0.0.1:11434",
  bridgeHost: "127.0.0.1",
  bridgePort: 17890,
  bridgeToken: "",
  aiProvider: "mock",
  customAiBaseUrl: "",
  customAiKey: "",
  customAiModel: "",
  customWhisperModel: "",
  aiModel: "",
  aiReplyMode: "semi",
  aiAutoReplyIntervalMs: 30000,
  aiAutoReplyManualChatIds: [],
  aiAutoReplyPolicy: { ...DEFAULT_AUTO_REPLY_POLICY },
  aiAutoReplyPolicyByAccountId: {},
  aiSystemPrompt: "",
  aiSystemPromptByAccountId: {},
  translateService: "auto",
  autoConnectBridge: true,
  sendChannel: "baileys",
  rateLimitEnabled: true,
  ratePerMinute: 8,
  ratePerHour: 80,
  rateMinIntervalSec: 4,
  quickReplies: defaultQuickReplies,
  translateTargetLang: "en",
  myLang: "",
  voiceInputEngine: "auto",
  voiceInputLang: "",
  leadInbox: createDefaultLeadInboxSettings(),
  chatFolders: [],
  chatFolderClones: [],
  // 不预置「主账号」；登录/添加后再有槽
  waAccounts: [],
  activeAccountId: DEFAULT_ACCOUNT_ID,
  liveBaileysAccountId: DEFAULT_ACCOUNT_ID,
  accountViewMode: { type: "all" },
  lockSendToActiveAccount: false,
  blocklistJids: [],
  blocklistByAccountId: {},
  historySyncNote: "",
  historySyncNoteByAccountId: {},
  internalNotesByKey: {},
  autoFollowUpEnabled: true,
  followUpRuleSettings: DEFAULT_FOLLOW_UP_RULE_SETTINGS,
  scheduledMessages: [],
  blockSendWhenOverheated: true,
  sendPausedAccountIds: [],
  rateJitterSec: 2,
  globalMinGapSec: 2,
  personPrimaryAccountByKey: {},
  desktopNotifyEnabled: true,
  notifyFollowUpEnabled: true,
  notifyGroupMessagesEnabled: false,
  notifyGroupJoinEnabled: false,
  autoReadGroupMessages: false,
  salesStageLabels: {},
  salesStageOrder: ["new", "contacted", "quoting", "won", "after_sales"],
  theme: "dark",
  uiLanguage: "zh-CN",
  chatBackground: { kind: "none" },
};

export function normalizeLoadedSettings(
  raw: Partial<SettingsShape> | undefined
): SettingsShape {
  const src = { ...(raw ?? {}) } as Partial<SettingsShape> &
    Record<string, unknown>;
  delete src.wahaBaseUrl;
  delete src.wahaApiKey;
  delete src.wahaSession;
  const merged: SettingsShape = {
    ...defaultSettings,
    ...(src as Partial<SettingsShape>),
  };
  const ch = String(merged.sendChannel ?? "");
  merged.sendChannel =
    ch === "android_bridge" ? "android_bridge" : "baileys";
  if (!Array.isArray(merged.quickReplies) || merged.quickReplies.length === 0) {
    merged.quickReplies = defaultQuickReplies;
  } else {
    merged.quickReplies = merged.quickReplies
      .map((r, i) => {
        const title = String(r?.title || "").slice(0, 40);
        const body = String(r?.body || "").slice(0, 2000);
        return {
          id: String(r?.id || `qr-${i}`),
          title,
          body,
          category: normalizeQuickReplyCategory(r?.category, title, body),
        };
      })
      .filter((r) => r.title || r.body)
      .slice(0, 40);
  }
  merged.theme = merged.theme === "light" ? "light" : "dark";
  merged.uiLanguage =
    merged.uiLanguage === "en" || merged.uiLanguage === "fr"
      ? merged.uiLanguage
      : "zh-CN";
  const tl = String(merged.translateTargetLang || "en").toLowerCase();  merged.translateTargetLang = tl || "en";
  const ml = String(merged.myLang || "").trim().toLowerCase();  merged.myLang = ml;
  merged.voiceInputEngine =
    merged.voiceInputEngine === "browser" || merged.voiceInputEngine === "ai"
      ? merged.voiceInputEngine
      : "auto";
  merged.voiceInputLang = normalizeVoiceInputLanguage(merged.voiceInputLang);
  {
    const base = defaultSettings.leadInbox;
    const raw = merged.leadInbox && typeof merged.leadInbox === "object"
      ? merged.leadInbox
      : base;
    const grouping = raw.dateGrouping;
    const scope = raw.accountScope;
    const sort = raw.sort;
    const days = Number(raw.dateRangeDays);
    merged.leadInbox = {
      enabled: raw.enabled !== false,
      includeGroups: raw.includeGroups === true,
      dateGrouping:
        grouping === "none" || grouping === "week" || grouping === "month"
          ? grouping
          : "day",
      dateRangeDays:
        Number.isFinite(days) && days > 0 ? Math.min(3650, Math.round(days)) : 0,
      accountScope:
        scope === "all" || scope === "selected" ? scope : "view",
      selectedAccountIds: Array.isArray(raw.selectedAccountIds)
        ? [...new Set(raw.selectedAccountIds.map((id) => String(id || "").trim()).filter(Boolean))].slice(0, 50)
        : [],
      mergeAccounts: raw.mergeAccounts !== false,
      sort:
        sort === "last_message" || sort === "unread" ? sort : "first_contact",
      removeAfterReply: raw.removeAfterReply === true,
      captureSince: String(raw.captureSince || base.captureSince),
      dismissedChatIds: Array.isArray(raw.dismissedChatIds)
        ? [
            ...new Set(
              raw.dismissedChatIds
                .map((id) => String(id || "").trim())
                .filter(Boolean)
            ),
          ].slice(0, 20_000)
        : [],
    };
  }
  {
    const raw = Array.isArray(merged.scheduledMessages)
      ? merged.scheduledMessages
      : [];
    merged.scheduledMessages = raw
      .filter((item) => item && typeof item === "object")
      .map((item) => {
        const value = item as Partial<ScheduledMessage>;
        return {
          id: String(value.id || ""),
          chatId: String(value.chatId || ""),
          contactId: String(value.contactId || ""),
          contactName: String(value.contactName || "").slice(0, 120),
          recipient: String(value.recipient || "").slice(0, 160),
          text: String(value.text || "").trim().slice(0, 4000),
          dueAt: String(value.dueAt || ""),
          channelId: value.channelId === "android_bridge" ? "android_bridge" : "baileys",
          deviceId: value.deviceId ? String(value.deviceId) : null,
          accountId: value.accountId ? String(value.accountId) : undefined,
          status:
            value.status === "queued" ||
            value.status === "sent" ||
            value.status === "failed" ||
            value.status === "cancelled"
              ? value.status
              : "pending",
          messageId: value.messageId ? String(value.messageId) : undefined,
          error: value.error ? String(value.error).slice(0, 240) : undefined,
          createdAt: String(value.createdAt || new Date().toISOString()),
        } satisfies ScheduledMessage;
      })
      .filter((item) => item.id && item.chatId && item.contactId && item.recipient && item.text && item.dueAt);
  }
  merged.customAiBaseUrl = String(merged.customAiBaseUrl || "").trim().replace(/\/+$/, "");
  merged.customAiModel = String(merged.customAiModel || "").trim();
  merged.customWhisperModel = String(merged.customWhisperModel || "").trim();
  merged.aiModel = String(merged.aiModel || "").trim();
  merged.bridgeToken = String(merged.bridgeToken || "").trim().slice(0, 256);
  merged.aiAutoReplyManualChatIds = Array.isArray(merged.aiAutoReplyManualChatIds)
    ? [...new Set(merged.aiAutoReplyManualChatIds.map((id) => String(id || "").trim()).filter(Boolean))]
    : [];
  merged.aiAutoReplyPolicy = normalizeAutoReplyPolicy(merged.aiAutoReplyPolicy);
  {
    const raw =
      merged.aiAutoReplyPolicyByAccountId &&
      typeof merged.aiAutoReplyPolicyByAccountId === "object"
        ? merged.aiAutoReplyPolicyByAccountId
        : {};
    const policies: Record<string, AiAutoReplyPolicy> = {};
    for (const [rawId, rawPolicy] of Object.entries(raw)) {
      const id = String(rawId || "").trim();
      if (id && rawPolicy && typeof rawPolicy === "object") {
        policies[id] = normalizeAutoReplyPolicy(
          rawPolicy,
          merged.aiAutoReplyPolicy
        );
      }
    }
    merged.aiAutoReplyPolicyByAccountId = policies;
  }
  {
    const raw =
      merged.aiSystemPromptByAccountId &&
      typeof merged.aiSystemPromptByAccountId === "object"
        ? merged.aiSystemPromptByAccountId
        : {};
    const prompts: Record<string, string> = {};
    for (const [rawId, rawPrompt] of Object.entries(raw)) {
      const id = String(rawId || "").trim();
      const prompt = typeof rawPrompt === "string" ? rawPrompt.trim().slice(0, 6000) : "";
      if (id && prompt) prompts[id] = prompt;
    }
    merged.aiSystemPromptByAccountId = prompts;
  }
  merged.translateService =
    merged.translateService === "google" || merged.translateService === "ai"
      ? merged.translateService
      : "auto";

  // 账号槽：去「主账号」幽灵、允许空列表
  merged.waAccounts = dedupeAccountLabels(ensureAccounts(merged.waAccounts));
  {
    const liveGuess =
      String(merged.liveBaileysAccountId || merged.activeAccountId || "").trim() ||
      DEFAULT_ACCOUNT_ID;
    merged.waAccounts = pruneGhostDefaultAccounts(merged.waAccounts, {
      preferKeepId: liveGuess,
    });
    // 清理：空槽误抄直播 userName
    const liveAcc = merged.waAccounts.find((a) => a.id === liveGuess);
    const liveName = (liveAcc?.userName || "").trim();
    if (liveName) {
      merged.waAccounts = merged.waAccounts.map((a) => {
        if (a.id === liveGuess) return a;
        if (
          (a.userName || "").trim() === liveName &&
          a.status !== "connected"
        ) {
          return {
            ...a,
            userName: undefined,
            status: "disconnected" as const,
            updatedAt: new Date().toISOString(),
          };
        }
        return a;
      });
    }
  }
  if (merged.waAccounts.length === 0) {
    // 新装 / 用户删光：允许 0 槽，不预置占位账号
    merged.activeAccountId = "";
    merged.liveBaileysAccountId = "";
    merged.accountViewMode = { type: "all" };
  } else {
    merged.activeAccountId = ensureActiveAccountId(
      merged.activeAccountId,
      merged.waAccounts
    );
    merged.liveBaileysAccountId = ensureActiveAccountId(
      merged.liveBaileysAccountId || merged.activeAccountId,
      merged.waAccounts
    );
    merged.accountViewMode = parseViewMode(
      merged.accountViewMode,
      merged.liveBaileysAccountId || merged.activeAccountId
    );
    if (merged.accountViewMode.type === "account") {
      const viewAccountId = merged.accountViewMode.accountId;
      const ok = merged.waAccounts.some((a) => a.id === viewAccountId);
      if (!ok) {
        merged.accountViewMode = {
          type: "account",
          accountId: merged.liveBaileysAccountId,
        };
      }
    }
  }
  merged.lockSendToActiveAccount = !!merged.lockSendToActiveAccount;
  const legacyBlock = Array.isArray(merged.blocklistJids)
    ? [
        ...new Set(
          merged.blocklistJids
            .map((j) => String(j || "").trim())
            .filter(Boolean)
        ),
      ].sort()
    : [];
  merged.blocklistJids = legacyBlock;
  const blMap: Record<string, string[]> = {};
  const rawBl =
    merged.blocklistByAccountId &&
    typeof merged.blocklistByAccountId === "object"
      ? merged.blocklistByAccountId
      : {};
  for (const [k, v] of Object.entries(rawBl)) {
    const id = String(k || "").trim();
    if (!id || !Array.isArray(v)) continue;
    blMap[id] = [
      ...new Set(v.map((j) => String(j || "").trim()).filter(Boolean)),
    ].sort();
  }
  // 旧全局列表迁到 live/active 槽
  const migrateAid =
    String(merged.liveBaileysAccountId || merged.activeAccountId || "").trim() ||
    "wa-default";
  if (legacyBlock.length && !blMap[migrateAid]?.length) {
    blMap[migrateAid] = legacyBlock;
  }
  merged.blocklistByAccountId = blMap;

  const legacyNote =
    typeof merged.historySyncNote === "string" ? merged.historySyncNote : "";
  merged.historySyncNote = legacyNote;
  const hnMap: Record<string, string> = {};
  const rawHn =
    merged.historySyncNoteByAccountId &&
    typeof merged.historySyncNoteByAccountId === "object"
      ? merged.historySyncNoteByAccountId
      : {};
  for (const [k, v] of Object.entries(rawHn)) {
    const id = String(k || "").trim();
    const note = typeof v === "string" ? v.trim() : "";
    if (id && note) hnMap[id] = note;
  }
  if (legacyNote && !hnMap[migrateAid]) hnMap[migrateAid] = legacyNote;
  merged.historySyncNoteByAccountId = hnMap;
  const rawNotes =
    merged.internalNotesByKey &&
    typeof merged.internalNotesByKey === "object"
      ? merged.internalNotesByKey
      : {};
  const notes: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawNotes)) {
    const key = String(k || "").trim();
    const val = typeof v === "string" ? v.trim().slice(0, 2000) : "";
    if (key && val) notes[key] = val;
  }
  merged.internalNotesByKey = notes;
  merged.autoFollowUpEnabled = merged.autoFollowUpEnabled !== false;
  if (!merged.personPrimaryAccountByKey || typeof merged.personPrimaryAccountByKey !== "object") {
    merged.personPrimaryAccountByKey = {};
  } else {
    const pm: Record<string, string> = {};
    for (const [k, v] of Object.entries(merged.personPrimaryAccountByKey)) {
      const key = String(k || "").trim();
      const val = String(v || "").trim();
      if (key && val) pm[key] = val;
    }
    merged.personPrimaryAccountByKey = pm;
  }
  merged.rateLimitEnabled = merged.rateLimitEnabled !== false;
  merged.blockSendWhenOverheated = merged.blockSendWhenOverheated !== false;
  {
    const raw = Array.isArray(merged.sendPausedAccountIds)
      ? merged.sendPausedAccountIds
      : [];
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const x of raw) {
      const id = String(x || "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    merged.sendPausedAccountIds = ids;
  }
  {
    const j = Number(merged.rateJitterSec);
    merged.rateJitterSec = Number.isFinite(j)
      ? Math.min(30, Math.max(0, j))
      : 2;
  }
  {
    const g = Number(merged.globalMinGapSec);
    merged.globalMinGapSec = Number.isFinite(g)
      ? Math.min(60, Math.max(0, g))
      : 2;
  }
  {
    const base = DEFAULT_FOLLOW_UP_RULE_SETTINGS;
    const raw = Array.isArray(merged.followUpRuleSettings)
      ? merged.followUpRuleSettings
      : [];
    const byId = new Map(
      raw.map((r) => [String((r as FollowUpRuleSetting)?.id || ""), r as FollowUpRuleSetting])
    );
    merged.followUpRuleSettings = base.map((b) => {
      const s = byId.get(b.id);
      const h = Number(s?.afterHours);
      return {
        id: b.id,
        enabled: s?.enabled !== false,
        afterHours:
          Number.isFinite(h) && h > 0
            ? Math.min(168, Math.max(1, Math.round(h)))
            : b.afterHours,
      };
    });
  }
  {
    const raw =
      merged.salesStageLabels && typeof merged.salesStageLabels === "object"
        ? merged.salesStageLabels
        : {};
    const out: Partial<Record<SalesStage, string>> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (!/^[a-z][a-z0-9_-]{0,39}$/i.test(k)) continue;
      const label = String(v || "").trim().slice(0, 20);
      if (label) out[k as SalesStage] = label;
    }
    merged.salesStageLabels = out;
    const rawOrder = Array.isArray(merged.salesStageOrder)
      ? merged.salesStageOrder
      : defaultSettings.salesStageOrder;
    merged.salesStageOrder = [
      ...new Set(
        rawOrder
          .map((id) => String(id || "").trim())
          .filter((id) => /^[a-z][a-z0-9_-]{0,39}$/i.test(id))
      ),
    ].slice(0, 20);
    if (!merged.salesStageOrder.length) {
      merged.salesStageOrder = [...defaultSettings.salesStageOrder];
    }
  }

  const defaultScopeAccount =
    merged.liveBaileysAccountId ||
    merged.activeAccountId ||
    DEFAULT_ACCOUNT_ID;

  // 规范化分组：同一 scope 内主归属互斥；分身不指向主组内同一 chat
  const rawFolders = Array.isArray(merged.chatFolders)
    ? merged.chatFolders
    : [];
  const seenPrimaryByScope = new Map<string, Set<string>>();
  merged.chatFolders = rawFolders
    .map((f, i) => {
      const id = String(f?.id || `folder-${i}`);
      const name = String(f?.name || "未命名分组").slice(0, 40);
      const sort = Number.isFinite(Number(f?.sort)) ? Number(f.sort) : i;
      const scope: FolderScope =
        f?.scope?.type === "all"
          ? { type: "all" }
          : {
              type: "account",
              accountId: String(
                f?.scope?.type === "account"
                  ? f.scope.accountId
                  : defaultScopeAccount
              ),
            };
      const scopeKey =
        scope.type === "all" ? "all" : `account:${scope.accountId}`;
      if (!seenPrimaryByScope.has(scopeKey)) {
        seenPrimaryByScope.set(scopeKey, new Set());
      }
      const seenPrimary = seenPrimaryByScope.get(scopeKey)!;
      const chatIds: string[] = [];
      for (const cid of Array.isArray(f?.chatIds) ? f.chatIds : []) {
        const c = String(cid || "");
        if (!c || seenPrimary.has(c)) continue;
        seenPrimary.add(c);
        chatIds.push(c);
      }
      return {
        id,
        name,
        ...(typeof f?.parentId === "string" && f.parentId
          ? { parentId: f.parentId }
          : {}),
        sort,
        collapsed: !!f?.collapsed,
        chatIds,
        scope,
      };
    })
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "zh"))
    .slice(0, 80);

  const folderIds = new Set(merged.chatFolders.map((f) => f.id));
  const primaryByChat = new Map<string, string>();
  for (const f of merged.chatFolders) {
    for (const cid of f.chatIds) primaryByChat.set(cid, f.id);
  }
  const rawClones = Array.isArray(merged.chatFolderClones)
    ? merged.chatFolderClones
    : [];
  const cloneKey = new Set<string>();
  merged.chatFolderClones = rawClones
    .map((c, i) => ({
      id: String(c?.id || `clone-${i}`),
      folderId: String(c?.folderId || ""),
      sourceChatId: String(c?.sourceChatId || ""),
    }))
    .filter((c) => {
      if (!c.folderId || !c.sourceChatId || !folderIds.has(c.folderId))
        return false;
      // 不可分身到自己的主分组
      if (primaryByChat.get(c.sourceChatId) === c.folderId) return false;
      const k = `${c.folderId}\0${c.sourceChatId}`;
      if (cloneKey.has(k)) return false;
      cloneKey.add(k);
      return true;
    })
    .slice(0, 200);

  return merged;
}
