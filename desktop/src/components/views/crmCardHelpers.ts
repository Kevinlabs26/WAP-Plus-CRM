import type { Contact } from "@/types/crm";
import { displayContactLabel, displayPhone } from "@/lib/utils";

/** 看板/列表一行：优先意向，其次摘要 */
export function insightLine(c: Contact, max = 48): string | null {
  const raw = (c.aiIntent || c.aiNextStep || c.aiSummary || c.notes || "").trim();
  if (!raw) return null;
  const one = raw.replace(/\s+/g, " ");
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

export function contactTitle(c: Contact): string {
  return displayContactLabel(c.name, c.phone, c.channelAddress, "", {
    isGroup: !!c.isGroup,
  });
}

export function needsDisplayName(c: Contact): boolean {
  if (c.isGroup) return false;
  const title = contactTitle(c);
  const phone = displayPhone(c.phone) || "";
  return (
    !title ||
    title === "未备注联系人" ||
    title === phone ||
    /^\+\d{7,15}$/.test(title)
  );
}