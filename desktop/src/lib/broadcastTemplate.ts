import type { Contact } from "@/types/crm";

/** 支持的简单变量：可见个性化，不做隐写/混淆 id */
export const BROADCAST_VARS = ["name", "company"] as const;

export const BROADCAST_DRAFT_CONTACT_IDS_KEY = "bridgecrm:broadcast-contact-ids";
export const BROADCAST_DRAFT_ACCOUNT_ID_KEY = "bridgecrm:broadcast-account-id";

export function normalizeBroadcastPhone(raw: string): string | null {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 ? `+${digits}` : null;
}

export function parseBroadcastPhones(raw: string): string[] {
  const seen = new Set<string>();
  const phones: string[] = [];
  for (const token of String(raw || "").split(/[\s,;，；]+/u)) {
    const phone = normalizeBroadcastPhone(token);
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    phones.push(phone);
  }
  return phones;
}

export function renderBroadcastTemplate(
  template: string,
  contact: Pick<Contact, "name" | "company">
): string {
  const rawName = (contact.name || "").trim();
  const name =
    rawName &&
    rawName !== "群成员" &&
    rawName !== "未备注联系人" &&
    !normalizeBroadcastPhone(rawName)
      ? rawName
      : "朋友";
  const company = (contact.company || "").trim() || "";
  return String(template || "")
    .replace(/\{name\}/gi, name)
    .replace(/\{company\}/gi, company)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function validateBroadcastTemplate(
  template: string
): { ok: true } | { ok: false; reason: string } {
  const t = String(template || "").trim();
  if (!t) return { ok: false, reason: "请填写发送内容" };
  if (t.length > 2000) return { ok: false, reason: "正文过长（最多 2000 字）" };
  // 仅允许 name/company 占位，避免用户塞奇怪 token
  const unknown = t.match(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g) || [];
  for (const raw of unknown) {
    const key = raw.slice(1, -1).toLowerCase();
    if (key !== "name" && key !== "company") {
      return {
        ok: false,
        reason: `不支持变量 ${raw}，仅可用 {name} {company}`,
      };
    }
  }
  return { ok: true };
}

export function estimateCampaignMinutes(
  count: number,
  gapMinSec: number,
  gapMaxSec = gapMinSec,
  minIntervalSec = 4
): number {
  if (count <= 0) return 0;
  const gap = Math.max((gapMinSec + Math.max(gapMinSec, gapMaxSec)) / 2, minIntervalSec, 1);
  return Math.max(1, Math.ceil((count * gap) / 60));
}

export function contactSendablePhone(c: Contact): string | null {
  const p = (c.phone || "").trim();
  if (!p) return null;
  return normalizeBroadcastPhone(p);
}
