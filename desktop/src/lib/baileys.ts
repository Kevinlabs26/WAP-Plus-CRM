/**
 * Baileys 后台桥接命令层。
 * 按职责拆分后此文件为统一入口（re-export），保证既有 import 兼容：
 * - baileysCore：runtime 管理 / request / status / events / sync
 * - baileysSend：文本 / 图片 / 贴纸 / GIF / 语音 / 文档 / 商品 / 转发 / presence
 * - baileysChatActions：回执 / 已读 / 删除 / 反应 / 媒体补下 / 重启 / 头像
 * - baileysLabels：标签与快捷话术
 */
import { request } from "./baileysCore";

export * from "./baileysCore";
export * from "./baileysSend";
export * from "./baileysCatalog";
export * from "./baileysChatActions";
export * from "./baileysLabels";
export * from "./baileysProfile";

export type BaileysPrivacySettings = Record<string, unknown>;

export const baileysPairingCode = (
  phoneNumber: string,
  accountId?: string | null
) =>
  request<{ ok: boolean; phoneNumber: string; code: string }>(
    "/pairing-code",
    { method: "POST", body: JSON.stringify({ phoneNumber }) },
    accountId
  );

export const baileysCheckNumbers = (
  numbers: string[],
  accountId?: string | null
) =>
  request<{ ok: boolean; results: { phoneNumber: string; exists: boolean; jid?: string }[] }>(
    "/check-numbers",
    { method: "POST", body: JSON.stringify({ numbers }) },
    accountId
  );

export const baileysPrivacy = (accountId?: string | null) =>
  request<{ ok: boolean; privacy: BaileysPrivacySettings }>(
    "/privacy",
    undefined,
    accountId
  );

export const baileysUpdatePrivacy = (
  patch: Record<string, unknown>,
  accountId?: string | null
) =>
  request<{ ok: boolean; privacy: BaileysPrivacySettings }>(
    "/privacy",
    { method: "POST", body: JSON.stringify(patch) },
    accountId
  );
