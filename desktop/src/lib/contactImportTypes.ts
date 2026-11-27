import type { SalesStage } from "@/types/crm";

/** Accepted fields per imported contact row. */
export type ImportContactInput = {
  name?: string;
  phone?: string;
  company?: string;
  country?: string;
  source?: string;
  owner?: string;
  stage?: string;
  tags?: string[];
  notes?: string;
  aiChatInstructions?: string;
  nextFollowUpAt?: string;
  accountId?: string;
};

export type ImportRowStatus = "ready" | "skip_dup" | "skip_no_phone" | "error";

export type DuplicateMatchSource = "existing_account" | "batch_duplicate";

export type DuplicateHandlingMode = "skip" | "fill_unnamed" | "overwrite";

export type ImportRowResult = {
  /** 1-based line number in the non-empty input lines (including header). */
  line: number;
  status: ImportRowStatus;
  reason?: string;
  /** Parsed row payload (populated for ready and duplicate/no-phone inspection). */
  input?: ImportContactInput;
  /** Distinguishes target-account collision from repeated phone within the pasted text. */
  duplicateSource?: DuplicateMatchSource;
  /** Matched local contact ID when duplicateSource is existing_account. */
  existingContactId?: string;
  /** All matched local contact IDs in the target account scope sharing this phone. */
  existingContactIds?: string[];
  /** Display name of the matched local contact when duplicateSource is existing_account. */
  existingContactName?: string;
  /** True when the matched local contact already has a non-placeholder human name. */
  existingContactHasHumanName?: boolean;
};

export type ContactImportResult = {
  rows: ImportRowResult[];
  created: ImportRowResult[];
  skipped: ImportRowResult[];
  errors: ImportRowResult[];
  detectedDelimiter: string;
  headers: string[];
  hasHeader: boolean;
};

export type ImportNameRule = {
  prefix: string;
  suffix: string;
  fallback: "phone" | "sequence";
};

export const HEADER_ALIASES: Record<string, keyof ImportContactInput> = {
  name: "name",
  姓名: "name",
  名字: "name",
  客户名: "name",
  联系人: "name",
  联系人姓名: "name",
  phone: "phone",
  电话: "phone",
  手机: "phone",
  手机号: "phone",
  手机号码: "phone",
  number: "phone",
  mobile: "phone",
  tel: "phone",
  company: "company",
  公司: "company",
  公司名: "company",
  单位: "company",
  企业: "company",
  客户公司: "company",
  country: "country",
  国家: "country",
  地区: "country",
  source: "source",
  来源: "source",
  渠道: "source",
  owner: "owner",
  负责人: "owner",
  归属: "owner",
  sales: "owner",
  stage: "stage",
  阶段: "stage",
  tags: "tags",
  标签: "tags",
  标记: "tags",
  notes: "notes",
  备注: "notes",
  说明: "notes",
  aichatinstructions: "aiChatInstructions",
  AI聊天补充说明: "aiChatInstructions",
  AI补充提示词: "aiChatInstructions",
  nextfollowupat: "nextFollowUpAt",
  下次跟进: "nextFollowUpAt",
  跟进时间: "nextFollowUpAt",
  下次跟进时间: "nextFollowUpAt",
  accountid: "accountId",
  账号: "accountId",
  账号id: "accountId",
};

export const STAGE_ALIASES: Record<string, SalesStage> = {
  new: "new",
  新客户: "new",
  未跟进: "new",
  contacted: "contacted",
  已联系: "contacted",
  联系中: "contacted",
  quoting: "quoting",
  报价中: "quoting",
  询价: "quoting",
  won: "won",
  成交: "won",
  已成交: "won",
  after_sales: "after_sales",
  售后: "after_sales",
};

export const POSITIONAL_IMPORT_FIELDS: (keyof ImportContactInput)[] = [
  "name",
  "phone",
  "company",
  "stage",
  "tags",
  "notes",
];
