import { normalizePlaybookPlans, normalizePlaybookSchedule, type PlaybookPlan, type PlaybookSchedule } from '@/lib/playbookPlans';
import { autoReplyDelayRange } from "@/lib/autoReplyDelay";
import { normalizeAiReplyTaskRecords, type AiReplyTaskRecord } from "@/lib/aiTaskRecords";
import type { AutoReplyMode } from "@/lib/autoReplyScope";
import { normalizePlaybooks, normalizePlaybookBindings, type AiPlaybook } from "@/lib/aiPlaybooks";
import { validTimeZone } from "@/lib/timeZone";
import { normalizeScheduledPlans, type ScheduledPlan } from "@/lib/scheduledPlans";
import {
  normalizeQuickReplyCategory,
  QUICK_REPLY_CATEGORIES,
  MAX_QUICK_REPLIES,
  MAX_RECENT_QUICK_REPLIES,
  normalizeQuickReplyIds,
  MAX_QUICK_REPLY_CATEGORIES,
  MAX_QUICK_REPLY_MEDIA_TOTAL_BYTES,
  type QuickReplyCategory,
  type QuickReplyCategoryOption,
  type QuickReplySheetLink,
} from "@/lib/quickReplies";

export interface SettingsQuickReply {
  id: string;
  title: string;
  body: string;
  translation?: string;
  category: QuickReplyCategory;
  sheetLink?: QuickReplySheetLink;
  /** 本地快捷话术媒体；WhatsApp 快捷指令同步只同步文字字段 */
  media?: {
    dataUrl: string;
    fileName: string;
    mimeType: string;
    kind: "image" | "audio" | "video" | "file";
    size: number;
  };
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
import { resolveTranscriptionConfig, type TranscriptionProvider } from "@/lib/transcriptionConfig";
import { resolveTranslationConfig, type TranslationProvider } from "@/lib/translationConfig";
import { DEFAULT_ACCOUNT_ID } from "@/types/account";
import { normalizePromptTemplates, type AiPromptTemplate } from "@/lib/aiPromptScope";
import { normalizeOutreachRule, normalizeOutreachRuns, type AiOutreachRule, type AiOutreachRun } from "@/lib/aiOutreachRules";
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
  icon?: string;
  color?: string;
  /** 可选父分组，支持多层嵌套。 */
  parentId?: string;
  sort: number;
  collapsed?: boolean;
  /** 主归属成员 chatId，在同一 scope 内互斥 */
  chatIds: string[];
  autoReplyMode?: AutoReplyMode;
  /** Empty or absent inherits the nearest parent / account / global identity. */
  aiSystemPrompt?: string;
  aiPromptMode?: "inherit" | "append" | "replace";
  aiPromptTemplateId?: string;
  aiPlaybookId?: string;
  sheetConnectionId?: string;
  aiPlaybookSchedule?: PlaybookSchedule;
  aiOutreach?: AiOutreachRule;
  aiReplyMaxChars?: number;
  aiReplyForbiddenTerms?: string[];
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

/** 主动联系智能夹子：成员按全部账号最早真实往来识别，账号范围仅影响显示。 */
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
  vertexProjectId:string;
  vertexLocation:string;
  vertexCredentialId:string;
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
    | "vertex"
    | "muse"
    | "ollama"
    | "custom";
  /** 自定义 OpenAI 兼容提供商 Base URL（如 https://api.deepseek.com/v1） */
  customAiBaseUrl: string;
  /** 自定义 OpenAI 兼容提供商 API Key */
  customAiKey: string;
  /** 回复 AI 的自定义提供商模型名。 */
  customAiModel: string;
  /** 旧版共用服务的转写模型，仅用于迁移。 */
  customWhisperModel: string;
  transcriptionProvider: TranscriptionProvider;
  transcriptionBaseUrl: string;
  transcriptionApiKey: string;
  transcriptionModel: string;
  transcriptionLocalFirst: boolean;
  translationProvider: TranslationProvider;
  translationBaseUrl: string;
  translationApiKey: string;
  translationModel: string;
  /** 当前提供商选的模型（OpenAI / Groq / Gemini / Ollama 共用）；空 = 用提供商默认 */
  aiModel: string;
  /**
   * 默认 AI 回复模式：semi=只出建议；auto=自动回复私聊；会话和文件夹可覆盖。
   * 自动模式按 aiSystemPrompt 适配身份与说话偏好。
   */
  aiReplyMode: "semi" | "auto";
  aiAutoReplyPaused: boolean;
  aiAutoReplyModeByChatId: Record<string, AutoReplyMode>;
  /** 自动回复防刷屏：同一会话两次自动回复的最小间隔（毫秒） */
  aiAutoReplyIntervalMs: number;
  aiAutoReplyDelayMinMs: number;
  aiAutoReplyDelayMaxMs: number;
  /** 单独交给人工处理的会话 id；全局自动回复仍可保留 */
  aiAutoReplyManualChatIds: string[];
  /** 默认自动回复策略；各账号可以完整覆盖 */
  aiAutoReplyPolicy: AiAutoReplyPolicy;
  aiAutoReplyPolicyByAccountId: Record<string, AiAutoReplyPolicy>;
  /** 自定义聊天身份/背景/说话方式/边界（注入 system prompt） */
  aiSystemPrompt: string;
  /** WhatsApp 账号级身份覆盖；空值或无条目时继承 aiSystemPrompt */
  aiSystemPromptByAccountId: Record<string, string>;
  aiPromptTemplates: AiPromptTemplate[];
  aiPlaybooks: AiPlaybook[];
  aiPlaybookPlans: PlaybookPlan[];
  aiPlaybookOverviewId: string;
  aiPlaybookBindings: Record<string, string>;
  aiPlaybookMuseRoot: string;
  aiPlaybookAutoSync: boolean;
  aiPlaybookMuseSyncedAt: number;
  aiPlaybookMuseAttemptAt: number;
  aiPlaybookMuseError: string;
  imagePromptTemplates: AiPromptTemplate[];
  aiContextMode: "compact" | "full";
  aiOutreachRuns: AiOutreachRun[];
  aiOutreachPaused: boolean;
  aiOutreachExcludedRecipients: string[];
  aiTaskDismissedIds: string[];
  aiReplyTaskRecords: AiReplyTaskRecord[];
  /** AI 回复的本人时区；空值跟随电脑时区。 */
  aiTimeZone: string;
  /**
   * 翻译策略：auto=独立翻译模型/Google；google=仅 Google；ai=仅独立翻译模型。
   */
  translateService: "auto" | "google" | "ai";
  autoConnectBridge: boolean;
  automaticBackupEnabled: boolean;
  sendChannel: "baileys" | "android_bridge";
  /** 是否启用分钟/小时/间隔限速；手动暂停与过热拦截独立 */
  rateLimitEnabled: boolean;
  ratePerMinute: number;
  ratePerHour: number;
  rateMinIntervalSec: number;
  quickReplies: SettingsQuickReply[];
  quickReplyCustomCategories: QuickReplyCategoryOption[];
  quickReplyRemovedCategories: string[];
  quickReplyCategoryLabels: Record<string, string>;
  quickReplyCategoryOrder: string[];
  quickReplyPinnedIds: string[];
  quickReplyRecentIds: string[];
  translateTargetLang: string;
  /** 回车两阶段：第一次翻译草稿，第二次发送译文。 */
  enterTranslateSend: boolean;
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
  /** 工作台待办是否包含群聊；通知栏独立显示群聊消息。 */
  todayIncludeGroups: boolean;
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
  scheduledPlans: ScheduledPlan[];
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
  notificationPrivacy: "full" | "name" | "hidden";
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
  folderDefaultColor?: string;
  folderColorDepth?: number;
  folderRowDensity?: "compact" | "standard" | "comfortable";
  showContactTagsInChatList: boolean;
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
  vertexProjectId:"",
  vertexLocation:"global",
  vertexCredentialId:"",
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
  transcriptionProvider: "none",
  transcriptionBaseUrl: "",
  transcriptionApiKey: "",
  transcriptionModel: "",
  transcriptionLocalFirst: true,
  translationProvider: "groq",
  translationBaseUrl: "https://api.groq.com/openai/v1",
  translationApiKey: "",
  translationModel: "",
  aiModel: "",
  aiReplyMode: "semi",
  aiAutoReplyPaused: false,
  aiAutoReplyModeByChatId: {},
  aiAutoReplyIntervalMs: 30000,
  aiAutoReplyDelayMinMs: 20000,
  aiAutoReplyDelayMaxMs: 60000,
  aiAutoReplyManualChatIds: [],
  aiAutoReplyPolicy: { ...DEFAULT_AUTO_REPLY_POLICY },
  aiAutoReplyPolicyByAccountId: {},
  aiSystemPrompt: "",
  aiSystemPromptByAccountId: {},
  aiPromptTemplates: [],
  aiPlaybooks: [],
  aiPlaybookPlans: [],
  aiPlaybookOverviewId: "",
  aiPlaybookBindings: {},
  aiPlaybookMuseRoot: "",
  aiPlaybookAutoSync: false,
  aiPlaybookMuseSyncedAt: 0,
  aiPlaybookMuseAttemptAt: 0,
  aiPlaybookMuseError: "",
  imagePromptTemplates: [],
  aiContextMode: "full",
  aiOutreachRuns: [],
  aiOutreachPaused: false,
  aiOutreachExcludedRecipients: [],
  aiTaskDismissedIds: [],
  aiReplyTaskRecords: [],
  aiTimeZone: "",
  translateService: "auto",
  automaticBackupEnabled: true,
  autoConnectBridge: true,
  sendChannel: "baileys",
  rateLimitEnabled: true,
  ratePerMinute: 8,
  ratePerHour: 80,
  rateMinIntervalSec: 4,
  quickReplies: defaultQuickReplies,
  quickReplyCustomCategories: [],
  quickReplyRemovedCategories: [],
  quickReplyCategoryLabels: {},
  quickReplyCategoryOrder: [],
  quickReplyPinnedIds: [],
  quickReplyRecentIds: [],
  translateTargetLang: "en",
  enterTranslateSend: false,
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
  todayIncludeGroups: false,
  lockSendToActiveAccount: false,
  blocklistJids: [],
  blocklistByAccountId: {},
  historySyncNote: "",
  historySyncNoteByAccountId: {},
  internalNotesByKey: {},
  autoFollowUpEnabled: true,
  followUpRuleSettings: DEFAULT_FOLLOW_UP_RULE_SETTINGS,
  scheduledMessages: [],
  scheduledPlans: [],
  blockSendWhenOverheated: true,
  sendPausedAccountIds: [],
  rateJitterSec: 2,
  globalMinGapSec: 2,
  personPrimaryAccountByKey: {},
  desktopNotifyEnabled: true,
  notificationPrivacy: "full",
  notifyFollowUpEnabled: true,
  notifyGroupMessagesEnabled: false,
  notifyGroupJoinEnabled: false,
  autoReadGroupMessages: false,
  salesStageLabels: {},
  salesStageOrder: ["new", "contacted", "quoting", "won", "after_sales"],
  theme: "dark",
  showContactTagsInChatList: false,
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
  const delay=autoReplyDelayRange(merged);
  merged.aiAutoReplyDelayMinMs=delay.min;merged.aiAutoReplyDelayMaxMs=delay.max;
  merged.todayIncludeGroups = merged.todayIncludeGroups === true;
  const categoryLabels = merged.quickReplyCategoryLabels;
  merged.quickReplyCategoryLabels = {};
  for (const category of QUICK_REPLY_CATEGORIES) {
    const label = categoryLabels?.[category.id];
    if (category.id !== "other" && typeof label === "string" && label.trim() && label.trim().length <= 32) merged.quickReplyCategoryLabels[category.id] = label.trim();
  }
  merged.quickReplyRemovedCategories = Array.isArray(merged.quickReplyRemovedCategories)
    ? [...new Set(merged.quickReplyRemovedCategories.filter(id => id !== "other" && QUICK_REPLY_CATEGORIES.some(category => category.id === id)))]
    : [];
  merged.quickReplyCustomCategories = Array.isArray(
    merged.quickReplyCustomCategories
  )
    ? merged.quickReplyCustomCategories
        .map((item, index) => ({
          id: String(item?.id || `custom-${index}`).trim().slice(0, 48),
          label: String(item?.label || "").trim().slice(0, 32),
          ...(typeof item?.parentId === "string" ? { parentId: item.parentId.trim().slice(0, 48) } : {}),
        }))
        .filter((item, index, items) =>
          item.id &&
          item.label &&
          !QUICK_REPLY_CATEGORIES.some((category) => category.id === item.id) &&
          items.findIndex((candidate) => candidate.id === item.id) === index
        )
        .slice(0, MAX_QUICK_REPLY_CATEGORIES)
    : [];
  const quickReplyCategoryIds = new Set(merged.quickReplyCustomCategories.map(category => category.id));
  const validCategoryIds = new Set<string>([...QUICK_REPLY_CATEGORIES.filter(category => !merged.quickReplyRemovedCategories.includes(category.id)).map(category => category.id), ...quickReplyCategoryIds]);
  merged.quickReplyCategoryOrder = Array.isArray(merged.quickReplyCategoryOrder)
    ? [...new Set(merged.quickReplyCategoryOrder.filter(id => typeof id === "string" && validCategoryIds.has(id)))].slice(0, MAX_QUICK_REPLY_CATEGORIES + QUICK_REPLY_CATEGORIES.length)
    : [];
  for (const category of merged.quickReplyCustomCategories) {
    if (!category.parentId || !validCategoryIds.has(category.parentId) || category.parentId === "other" || category.parentId === category.id) delete category.parentId;
  }
  for (const category of merged.quickReplyCustomCategories) {
    const seen = new Set([category.id]);
    let parentId = category.parentId;
    while (parentId) {
      if (seen.has(parentId)) { delete category.parentId; break; }
      seen.add(parentId);
      parentId = merged.quickReplyCustomCategories.find(item => item.id === parentId)?.parentId;
    }
  }
  const ch = String(merged.sendChannel ?? "");
  merged.scheduledPlans = normalizeScheduledPlans(merged.scheduledPlans);
  merged.sendChannel =
    ch === "android_bridge" ? "android_bridge" : "baileys";
  if (!Array.isArray(merged.quickReplies)) {
    merged.quickReplies = defaultQuickReplies.map(reply => ({ ...reply, category: normalizeQuickReplyCategory(reply.category, reply.title, reply.body, merged.quickReplyCustomCategories, merged.quickReplyRemovedCategories) }));
  } else {
    let quickReplyMediaBytes = 0;
    merged.quickReplies = merged.quickReplies
      .map((r, i) => {
        const title = String(r?.title || "").slice(0, 40);
        const body = String(r?.body || "").slice(0, 2000);
        const translation = String(r?.translation || "").slice(0, 2000);
        const rawMedia =
          r?.media && typeof r.media === "object"
            ? (r.media as Record<string, unknown>)
            : null;
        const dataUrl = String(rawMedia?.dataUrl || "");
        const mimeType = String(rawMedia?.mimeType || "").slice(0, 120);
        const kind: "image" | "audio" | "video" | "file" =
          rawMedia?.kind === "image" ||
          rawMedia?.kind === "audio" ||
          rawMedia?.kind === "video" ||
          rawMedia?.kind === "file"
            ? rawMedia.kind
            : "file";
        const mediaSize = Math.max(
          0,
          Math.min(
            12 * 1024 * 1024,
            Number(rawMedia?.size) || Math.floor(dataUrl.length * 0.75)
          )
        );
        const keepMedia =
          dataUrl.startsWith("data:") &&
          dataUrl.length <= 12 * 1024 * 1024 &&
          quickReplyMediaBytes + mediaSize <= MAX_QUICK_REPLY_MEDIA_TOTAL_BYTES;
        if (keepMedia) quickReplyMediaBytes += mediaSize;
        const media = keepMedia
            ? {
                dataUrl,
                fileName: String(rawMedia?.fileName || "媒体").slice(0, 180),
                mimeType,
                kind,
                size: mediaSize,
              }
            : undefined;
        const rawLink = r?.sheetLink && typeof r.sheetLink === "object" ? r.sheetLink as Record<string, unknown> : null;
        const spreadsheetId = String(rawLink?.spreadsheetId || "");
        const tab = String(rawLink?.tab || "");
        const row = Number(rawLink?.row);
        const originalColumn = Number(rawLink?.originalColumn);
        const translationColumn = Number(rawLink?.translationColumn);
        const sheetLink = rawLink && /^[a-zA-Z0-9_-]{1,200}$/.test(spreadsheetId) && tab.trim() && tab.length <= 200 && !/[\u0000-\u001f]/.test(tab) && Number.isInteger(row) && row >= 0 && row <= 10_000_000 && Number.isInteger(originalColumn) && originalColumn >= 0 && originalColumn <= 18_277 && Number.isInteger(translationColumn) && translationColumn >= 0 && translationColumn <= 18_277 && originalColumn !== translationColumn
          ? { spreadsheetId, tab, row, originalColumn, translationColumn, titleSnapshot: String(rawLink.titleSnapshot ?? title).slice(0, 40), originalSnapshot: String(rawLink.originalSnapshot || "").slice(0, 2000), translationSnapshot: String(rawLink.translationSnapshot || "").slice(0, 2000), syncPending: rawLink.syncPending === true || undefined, syncError: String(rawLink.syncError || "").slice(0, 200) || undefined }
          : undefined;
        return {
          id: String(r?.id || `qr-${i}`),
          title,
          body,
          ...(translation ? { translation } : {}),
          ...(sheetLink ? { sheetLink } : {}),
          media,
          category: normalizeQuickReplyCategory(
            r?.category,
            title,
            body,
            merged.quickReplyCustomCategories,
            merged.quickReplyRemovedCategories
          ),
        };
      })
      .filter((r) => r.title || r.body || r.media)
      .slice(0, MAX_QUICK_REPLIES);
  }
  merged.quickReplyPinnedIds = normalizeQuickReplyIds(merged.quickReplyPinnedIds, merged.quickReplies, MAX_QUICK_REPLIES);
  merged.quickReplyRecentIds = normalizeQuickReplyIds(merged.quickReplyRecentIds, merged.quickReplies, MAX_RECENT_QUICK_REPLIES);
  merged.notificationPrivacy = merged.notificationPrivacy === "name" || merged.notificationPrivacy === "hidden"
    ? merged.notificationPrivacy : "full";
  merged.theme = merged.theme === "light" ? "light" : "dark";
  merged.folderDefaultColor=typeof merged.folderDefaultColor==="string"&&/^#[0-9a-f]{6}$/i.test(merged.folderDefaultColor)?merged.folderDefaultColor:undefined;
  merged.folderColorDepth=typeof merged.folderColorDepth==="number"&&Number.isFinite(merged.folderColorDepth)?Math.min(40,Math.max(0,merged.folderColorDepth)):10;
  if(merged.folderRowDensity!=="compact"&&merged.folderRowDensity!=="comfortable")merged.folderRowDensity="standard";
  merged.showContactTagsInChatList = merged.showContactTagsInChatList === true;
  merged.uiLanguage =
    merged.uiLanguage === "en" || merged.uiLanguage === "fr"
      ? merged.uiLanguage
      : "zh-CN";
  const tl = String(merged.translateTargetLang || "en").toLowerCase();  merged.translateTargetLang = tl || "en";
  merged.enterTranslateSend = merged.enterTranslateSend === true;
  const ml = String(merged.myLang || "").trim().toLowerCase();  merged.myLang = ml;
  merged.aiTimeZone = validTimeZone(merged.aiTimeZone) || "";
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
            !Number.isFinite(Date.parse(String(value.dueAt || ""))) ? "failed" :
            value.status === "queued" ||
            value.status === "sent" ||
            value.status === "failed" ||
            value.status === "expired" ||
            value.status === "cancelled"
              ? value.status
              : "pending",
          messageId: value.messageId ? String(value.messageId) : undefined,
          error: !Number.isFinite(Date.parse(String(value.dueAt || "")))
            ? "无效的定时发送时间"
            : value.error ? String(value.error).slice(0, 240) : undefined,
          createdAt: String(value.createdAt || new Date().toISOString()),
        } satisfies ScheduledMessage;
      })
      .filter((item) => item.id && item.chatId && item.contactId && item.recipient && item.text && item.dueAt);
  }
  merged.customAiBaseUrl = String(merged.customAiBaseUrl || "").trim().replace(/\/+$/, "");
  merged.customAiModel = String(merged.customAiModel || "").trim();
  merged.customWhisperModel = String(merged.customWhisperModel || "").trim();
  const transcription = resolveTranscriptionConfig(src);
  merged.transcriptionProvider = transcription.provider;
  merged.transcriptionBaseUrl = transcription.baseUrl;
  merged.transcriptionApiKey = transcription.apiKey;
  merged.transcriptionModel = transcription.model;
  merged.transcriptionLocalFirst = src.transcriptionLocalFirst !== false;
  const translation = resolveTranslationConfig(src);
  merged.translationProvider = translation.provider;
  merged.translationBaseUrl = translation.baseUrl;
  merged.translationApiKey = translation.apiKey;
  merged.translationModel = translation.model;
  merged.aiModel = String(merged.aiModel || "").trim();
  merged.vertexProjectId=String(merged.vertexProjectId||"").trim().slice(0,63);
  merged.vertexLocation=String(merged.vertexLocation||"global").trim().slice(0,40);
  merged.vertexCredentialId=typeof merged.vertexCredentialId==="string"&&/^[a-f0-9]{64}$/.test(merged.vertexCredentialId)?merged.vertexCredentialId:"";
  merged.bridgeToken = String(merged.bridgeToken || "").trim().slice(0, 256);
  merged.aiAutoReplyManualChatIds = Array.isArray(merged.aiAutoReplyManualChatIds)
    ? [...new Set(merged.aiAutoReplyManualChatIds.map((id) => String(id || "").trim()).filter(Boolean))]
    : [];
  merged.aiAutoReplyPaused = merged.aiAutoReplyPaused === true;
  merged.aiPromptTemplates = normalizePromptTemplates(merged.aiPromptTemplates);
  merged.aiPlaybookPlans = normalizePlaybookPlans(merged.aiPlaybookPlans);
  merged.aiPlaybooks = normalizePlaybooks(merged.aiPlaybooks);
  merged.aiPlaybookOverviewId = typeof merged.aiPlaybookOverviewId === "string" ? merged.aiPlaybookOverviewId.slice(0,120) : "";
  merged.aiPlaybookBindings = normalizePlaybookBindings(merged.aiPlaybookBindings);
  merged.aiPlaybookMuseRoot = typeof merged.aiPlaybookMuseRoot === "string" && merged.aiPlaybookMuseRoot.length <= 500 ? merged.aiPlaybookMuseRoot : "";
  merged.aiPlaybookAutoSync = merged.aiPlaybookAutoSync === true;
  merged.aiPlaybookMuseSyncedAt = Number.isFinite(merged.aiPlaybookMuseSyncedAt) && merged.aiPlaybookMuseSyncedAt > 0 ? merged.aiPlaybookMuseSyncedAt : 0;
  merged.aiPlaybookMuseAttemptAt = Number.isFinite(merged.aiPlaybookMuseAttemptAt) && merged.aiPlaybookMuseAttemptAt > 0 ? merged.aiPlaybookMuseAttemptAt : 0;
  merged.aiPlaybookMuseError = typeof merged.aiPlaybookMuseError === "string" ? merged.aiPlaybookMuseError.slice(0,400) : "";
  merged.imagePromptTemplates = normalizePromptTemplates(merged.imagePromptTemplates).map(item => ({ ...item, prompt: item.prompt.slice(0, 4000) }));
  merged.aiContextMode = merged.aiContextMode === "compact" ? "compact" : "full";
  merged.aiOutreachRuns = normalizeOutreachRuns(merged.aiOutreachRuns);
  merged.aiOutreachPaused = merged.aiOutreachPaused === true;
  merged.aiOutreachExcludedRecipients = Array.isArray(merged.aiOutreachExcludedRecipients)?[...new Set(merged.aiOutreachExcludedRecipients.filter((value):value is string=>typeof value==="string"&&!!value.trim()&&value.length<=240).map(value=>value.trim()))].slice(0,50_000):[];
  merged.aiTaskDismissedIds = Array.isArray(merged.aiTaskDismissedIds)?[...new Set(merged.aiTaskDismissedIds.filter((value):value is string=>typeof value==="string"&&value.length>0&&value.length<=600))].slice(-50_000):[];
  merged.aiReplyTaskRecords = normalizeAiReplyTaskRecords(merged.aiReplyTaskRecords);
  merged.aiAutoReplyModeByChatId = Object.fromEntries(
    Object.entries(merged.aiAutoReplyModeByChatId && typeof merged.aiAutoReplyModeByChatId === "object" ? merged.aiAutoReplyModeByChatId : {})
      .filter(([id, mode]) => id.trim() && (mode === "auto" || mode === "manual"))
  );
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
      const prompt = typeof rawPrompt === "string" ? rawPrompt.trim() : "";
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
        ...(typeof f?.icon === "string" && /^[\p{Emoji_Presentation}\p{Extended_Pictographic}]$/u.test(f.icon) ? { icon: f.icon } : {}),
        ...(typeof f?.color === "string" && /^#[0-9a-f]{6}$/i.test(f.color) ? { color: f.color } : {}),
        ...(typeof f?.parentId === "string" && f.parentId
          ? { parentId: f.parentId }
          : {}),
        sort,
        collapsed: !!f?.collapsed,
        ...(f?.autoReplyMode === "auto" || f?.autoReplyMode === "manual" ? { autoReplyMode: f.autoReplyMode } : {}),
        ...(typeof f?.sheetConnectionId==="string"&&/^[\w-]{1,120}$/.test(f.sheetConnectionId)?{sheetConnectionId:f.sheetConnectionId}:{}),
        ...(typeof f?.aiSystemPrompt === "string" && f.aiSystemPrompt.trim()
          ? { aiSystemPrompt: f.aiSystemPrompt.trim().slice(0, 6000) } : {}),
        ...(f?.aiPromptMode === "inherit" || f?.aiPromptMode === "append" || f?.aiPromptMode === "replace" ? {aiPromptMode: f.aiPromptMode} : {}),
        ...(typeof f?.aiPromptTemplateId === "string" && f.aiPromptTemplateId ? {aiPromptTemplateId: f.aiPromptTemplateId.slice(0,120)} : {}),
        ...(f?.aiPlaybookSchedule ? {aiPlaybookSchedule:normalizePlaybookSchedule(f.aiPlaybookSchedule)} : {}),
        ...(typeof f?.aiPlaybookId === "string" && f.aiPlaybookId ? {aiPlaybookId: f.aiPlaybookId.slice(0,120)} : {}),
        ...(f?.aiOutreach ? {aiOutreach: normalizeOutreachRule(f.aiOutreach)} : {}),
        ...(typeof f?.aiReplyMaxChars==="number"&&Number.isFinite(f.aiReplyMaxChars)?{aiReplyMaxChars:Math.min(2000,Math.max(20,Math.round(f.aiReplyMaxChars)))}:{}),
        ...(Array.isArray(f?.aiReplyForbiddenTerms)?{aiReplyForbiddenTerms:[...new Set(f.aiReplyForbiddenTerms.filter((term):term is string=>typeof term==="string"&&!!term.trim()).map(term=>term.trim().slice(0,100)))].slice(0,50)}:{}),
        chatIds,
        scope,
      };
    })
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "zh"));

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
