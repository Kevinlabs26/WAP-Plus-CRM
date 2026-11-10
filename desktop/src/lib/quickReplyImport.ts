import { splitCsvLine } from "./contactImport.ts";
import { MAX_QUICK_REPLIES } from "./quickReplies.ts";
import type { QuickReplySheetLink } from "./quickReplies.ts";

const ORIGINAL_HEADER = /^(?:\p{Script=Han}{0,6}\s*)?(?:原文|原始|original|source|texte\s*original)$/iu;
const TRANSLATION_HEADER = /^(?:\p{Script=Han}{0,6}\s*)?(?:翻译|译文|translation|translated|traduction|target)$/iu;

/** Excel/CSV records, including quoted multiline bodies. No files or formulas are executed. */
export function parseQuickReplyTable(input: string) {
  if (input.length > 3_000_000) throw new Error("limit");
  const text = input.replace(/^\uFEFF/, "");
  const records: string[] = [];
  let quoted = false, start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      if (quoted && text[i + 1] === '"') { i++; continue; }
      quoted = !quoted;
    } else if (text[i] === "\n" && !quoted) {
      if (text.slice(start, i).trim()) records.push(text.slice(start, i));
      start = i + 1;
    }
  }
  if (quoted) throw new Error("format");
  if (text.slice(start).trim()) records.push(text.slice(start));
  if (records.length > MAX_QUICK_REPLIES + 1) throw new Error("limit");
  // Count separators outside quoted fields so punctuation in French bodies is not mistaken for columns.
  const counts = new Map([["\t", 0], [",", 0], [";", 0]]);
  quoted = false;
  for (let i = 0; i < (records[0] || "").length; i++) {
    const char = records[0][i];
    if (char === '"') {
      if (quoted && records[0][i + 1] === '"') { i++; continue; }
      quoted = !quoted;
    } else if (!quoted && counts.has(char)) counts.set(char, counts.get(char)! + 1);
  }
  const delimiter = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  const rows: { title: string; body: string; category: string; translation?: string; parent?: string }[] = [];
  const invalidRows: number[] = [];
  records.forEach((record, index) => {
    const fields = splitCsvLine(record, delimiter);
    const [title = "", body = "", category = "", translation = "", parent = ""] = fields;
    if (index === 0 && /^(标题|名称|title|titre|原文|source|original)$/i.test(title) && /^(内容|正文|body|content|contenu|text|原文|source|original|译文|翻译|translation|translated|traduction)$/i.test(body)) return;
    if (fields.length < 2 || fields.length > 5 || !title || (!body && !translation) || title.length > 40 || body.length > 2000 || category.length > 32 || translation.length > 2000 || parent.length > 32) {
      invalidRows.push(index + 1); return;
    }
    rows.push({ title, body, category, ...(translation ? { translation } : {}), ...(parent ? { parent } : {}) });
  });
  if (rows.length > MAX_QUICK_REPLIES) throw new Error("limit");
  return { rows, invalidRows };
}

export function quickReplyRowsToTsv(rows: readonly (readonly string[])[]) {
  return rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join("\t")).join("\n");
}

export function quickReplySheetRowsWithLinks(
  sheets: readonly { name: string; columns: readonly (readonly unknown[])[] }[],
  groupName: string,
  spreadsheetId: string,
  options: { originalColumn?: number; translationColumn?: number; titleSource?: "original" | "translation" } = {},
) {
  const rows: string[][] = [];
  const links: QuickReplySheetLink[] = [];
  const originalColumn = options.originalColumn ?? 0;
  const translationColumn = options.translationColumn ?? 1;
  const titleSource = options.titleSource ?? "original";
  // shortcut: Tab names beyond 32 characters are shortened to fit category labels; rename long tabs if they must stay distinct.
  for (const sheet of sheets) {
    const originals = sheet.columns[originalColumn] || [];
    const translations = sheet.columns[translationColumn] || [];
    for (let index = 0; index < Math.max(originals.length, translations.length); index++) {
      const original = String(originals[index] ?? "").trim();
      const translation = String(translations[index] ?? "").trim();
      if (index === 0 && ((ORIGINAL_HEADER.test(original) && TRANSLATION_HEADER.test(translation)) || (TRANSLATION_HEADER.test(original) && ORIGINAL_HEADER.test(translation)))) continue;
      if (!original && !translation) continue;
      if (original.length > 2000 || translation.length > 2000) throw new Error("contentTooLong");
      const titleText = (titleSource === "translation" ? translation : original) || original || translation;
      const title = (titleText.split("\n")[0] || titleText).trim().slice(0, 40) || titleText.slice(0, 40);
      const body = original.slice(0, 2000);
      const safeTranslation = translation.slice(0, 2000);
      rows.push([title, body, sheet.name.slice(0, 32), safeTranslation, groupName.slice(0, 32)]);
      links.push({ spreadsheetId, tab: sheet.name, row: index + 1, originalColumn, translationColumn, titleSnapshot: title, originalSnapshot: original, translationSnapshot: safeTranslation });
      if (rows.length > MAX_QUICK_REPLIES) throw new Error("limit");
    }
  }
  return { rows, links };
}

export function quickReplySheetRows(
  sheets: readonly { name: string; columns: readonly (readonly unknown[])[] }[],
  groupName = "",
  options: { originalColumn?: number; translationColumn?: number; titleSource?: "original" | "translation" } = {},
) {
  return quickReplySheetRowsWithLinks(sheets, groupName, "", options).rows;
}
