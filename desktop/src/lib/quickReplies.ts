export const QUICK_REPLY_CATEGORIES = [
  { id: "opening", label: "开场" },
  { id: "quote", label: "报价" },
  { id: "follow-up", label: "跟进" },
  { id: "after-sales", label: "售后" },
  { id: "other", label: "其他" },
] as const;

export type QuickReplyCategory =
  (typeof QUICK_REPLY_CATEGORIES)[number]["id"];
export type QuickReplyCategoryFilter = QuickReplyCategory | "all";

export function normalizeQuickReplyCategory(
  value: unknown,
  title = "",
  body = ""
): QuickReplyCategory {
  if (QUICK_REPLY_CATEGORIES.some((category) => category.id === value)) {
    return value as QuickReplyCategory;
  }
  const text = `${title} ${body}`;
  if (/招呼|您好|你好|hello|welcome/i.test(text)) return "opening";
  if (/报价|询价|价格|型号|数量|price|quote/i.test(text)) return "quote";
  if (/跟进|确认|方案|进展|follow.?up/i.test(text)) return "follow-up";
  if (/售后|物流|退款|维修|保修|after.?sales/i.test(text)) return "after-sales";
  return "other";
}

export function filterQuickReplies<
  T extends { title: string; body: string; category: QuickReplyCategory },
>(items: T[], category: QuickReplyCategoryFilter, query: string): T[] {
  const keyword = query.trim().toLocaleLowerCase();
  return items.filter(
    (item) =>
      (category === "all" || item.category === category) &&
      (!keyword ||
        `${item.title}\n${item.body}`.toLocaleLowerCase().includes(keyword))
  );
}
