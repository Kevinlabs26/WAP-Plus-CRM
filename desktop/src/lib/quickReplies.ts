export const QUICK_REPLY_CATEGORIES = [
  { id: "opening", label: "开场" },
  { id: "quote", label: "报价" },
  { id: "follow-up", label: "跟进" },
  { id: "after-sales", label: "售后" },
  { id: "other", label: "其他" },
] as const;

export const MAX_QUICK_REPLIES = 1000;
export const MAX_RECENT_QUICK_REPLIES = 20;
export const MAX_QUICK_REPLY_CATEGORIES = 100;
export const MAX_QUICK_REPLY_MEDIA_BYTES = 8 * 1024 * 1024;
// shortcut: Media remains inline in settings (64 MB total); use file storage if larger media libraries are needed.
export const MAX_QUICK_REPLY_MEDIA_TOTAL_BYTES = 64 * 1024 * 1024;

export type QuickReplyCategory =
  | (typeof QUICK_REPLY_CATEGORIES)[number]["id"]
  | (string & {});
export type QuickReplyCategoryFilter = QuickReplyCategory | "all";

export type QuickReplyCategoryOption = {
  id: string;
  label: string;
  parentId?: string;
};

export type QuickReplySheetLink = {
  spreadsheetId: string;
  tab: string;
  row: number;
  originalColumn: number;
  translationColumn: number;
  titleSnapshot?: string;
  originalSnapshot: string;
  translationSnapshot: string;
  syncPending?: boolean;
  syncError?: string;
};

export function getQuickReplyCategories(
  custom: QuickReplyCategoryOption[] = [],
  removed: string[] = [],
  labels: Record<string, string> = {},
  order: string[] = []
): QuickReplyCategoryOption[] {
  const seen = new Set<string>(QUICK_REPLY_CATEGORIES.map((item) => item.id));
  const categories = [
    ...QUICK_REPLY_CATEGORIES.filter(item => item.id === "other" || !removed.includes(item.id)).map(item => ({ ...item, label: labels[item.id] || item.label })),
    ...custom.filter((item) => {
      const id = String(item?.id || "").trim();
      const label = String(item?.label || "").trim();
      if (!id || !label || seen.has(id)) return false;
      seen.add(id);
      return true;
    }),
  ];
  const positions = new Map(order.map((id, index) => [id, index]));
  return categories.sort((a, b) => (positions.get(a.id) ?? order.length) - (positions.get(b.id) ?? order.length));
}

export function quickReplyCategoryDescendants(id: string, categories: QuickReplyCategoryOption[]) {
  const ids = new Set([id]);
  for (let changed = true; changed;) {
    changed = false;
    for (const category of categories) if (category.parentId && ids.has(category.parentId) && !ids.has(category.id)) {
      ids.add(category.id); changed = true;
    }
  }
  return ids;
}

export function flattenQuickReplyCategories(categories: QuickReplyCategoryOption[]) {
  const rows: { category: QuickReplyCategoryOption; depth: number; hasChildren: boolean }[] = [];
  const visit = (parentId: string | undefined, depth: number, ancestors: Set<string>) => {
    for (const category of categories.filter(item => item.parentId === parentId)) {
      if (ancestors.has(category.id)) continue;
      const children = categories.some(item => item.parentId === category.id);
      rows.push({ category, depth, hasChildren: children });
      visit(category.id, depth + 1, new Set(ancestors).add(category.id));
    }
  };
  visit(undefined, 0, new Set());
  return rows;
}

export function normalizeQuickReplyCategory(
  value: unknown,
  title = "",
  body = "",
  custom: QuickReplyCategoryOption[] = [],
  removed: string[] = []
): QuickReplyCategory {
  if (typeof value === "string" && value !== "other" && removed.includes(value)) return "other";
  if (
    QUICK_REPLY_CATEGORIES.some((category) => category.id === value) ||
    custom.some((category) => category.id === value)
  ) {
    return value as QuickReplyCategory;
  }
  const text = `${title} ${body}`;
  if (/招呼|您好|你好|hello|welcome/i.test(text) && !removed.includes("opening")) return "opening";
  if (/报价|询价|价格|型号|数量|price|quote/i.test(text) && !removed.includes("quote")) return "quote";
  if (/跟进|确认|方案|进展|follow.?up/i.test(text) && !removed.includes("follow-up")) return "follow-up";
  if (/售后|物流|退款|维修|保修|after.?sales/i.test(text) && !removed.includes("after-sales")) return "after-sales";
  return "other";
}

export function filterQuickReplies<
  T extends {
    title: string;
    body: string;
    translation?: string;
    category: string;
    media?: { fileName?: string };
  },
>(items: T[], category: QuickReplyCategoryFilter, query: string): T[] {
  const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const keywords = normalize(query).trim().split(/\s+/u).filter(Boolean);
  return items.filter(item => {
    if (category !== "all" && item.category !== category) return false;
    const text = normalize(`${item.title}\n${item.body}\n${item.translation || ""}\n${item.media?.fileName || ""}`);
    return keywords.every(keyword => text.includes(keyword));
  });
}

export function quickReplyPreviewText(title: string, value: string) {
  const content = value.trim();
  const heading = title.trim();
  const firstLine = content.split(/\r?\n/, 1)[0]?.trim() || "";
  if (!heading || firstLine !== heading && !(heading.length === 40 && firstLine.startsWith(heading))) return content;
  return content.slice(heading.length).trim();
}

export function normalizeQuickReplyIds(value: unknown, replies: { id: string }[], limit: number): string[] {
  const valid = new Set(replies.map(reply => reply.id));
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && valid.has(id)))].slice(0, limit) : [];
}
