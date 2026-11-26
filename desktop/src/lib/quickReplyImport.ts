import { splitCsvLine } from "./contactImport.ts";
import type { QuickReplySheetLink } from "./quickReplies.ts";

const ORIGINAL_HEADER = /^(?:\p{Script=Han}{0,6}\s*)?(?:原文|原始|original|source|texte\s*original)$/iu;
const TRANSLATION_HEADER = /^(?:\p{Script=Han}{0,6}\s*)?(?:翻译|译文|translation|translated|traduction|target)$/iu;
export const QUICK_REPLY_TEXT_IMPORT_LIMIT = 3_000_000;

function parseTabbedWorkspaceJson(text: string) {
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { throw new Error("format"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("format");
  const tabs = (parsed as { tabs?: unknown }).tabs;
  if (!tabs || typeof tabs !== "object" || Array.isArray(tabs)) throw new Error("format");

  const rows: { title: string; body: string; category: string; translation?: string; parent?: string }[] = [];
  const invalidRows: number[] = [];
  let sourceRow = 0;
  let foundData = false;
  const textCell = (value: unknown) => typeof value === "string" || typeof value === "number"
    ? String(value).replace(/\u0000/g, "").trim()
    : "";

  for (const tab of Object.values(tabs)) {
    if (!tab || typeof tab !== "object" || Array.isArray(tab)) continue;
    const record = tab as { workname?: unknown; data?: unknown };
    if (!Array.isArray(record.data)) continue;
    foundData = true;
    const category = typeof record.workname === "string"
      ? record.workname.trim()
      : "";
    for (const source of record.data) {
      sourceRow++;
      if (!Array.isArray(source)) { invalidRows.push(sourceRow); continue; }
      // These exports store the original and translation in the first two cells;
      // remaining language slots are often empty and are intentionally ignored.
      const body = textCell(source[0]);
      const translation = textCell(source[1]);
      if (!body && !translation) continue;
      const titleLine = (body || translation).split(/\r?\n/).find(line => line.trim()) || "";
      const title = titleLine.trim();
      if (!title) continue;
      rows.push({ title, body, category, ...(translation ? { translation } : {}) });
    }
  }
  if (!foundData) throw new Error("format");
  return { rows, invalidRows };
}

/** Excel/CSV records, including quoted multiline bodies. No files or formulas are executed. */
export function parseQuickReplyTable(input: string) {
  if (input.length > QUICK_REPLY_TEXT_IMPORT_LIMIT) throw new Error("limit");
  const text = input.replace(/^\uFEFF/, "");
  if (text.trimStart().startsWith("{")) return parseTabbedWorkspaceJson(text);
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
  const accumulator = quickReplyRecordAccumulator();
  records.forEach(accumulator.add);
  return accumulator.result;
}

type QuickReplyImportRow = { title: string; body: string; category: string; translation?: string; parent?: string };

function quickReplyDelimiter(record: string) {
  // Count separators outside quoted fields so punctuation in French bodies is not mistaken for columns.
  const counts = new Map([["\t", 0], [",", 0], [";", 0]]);
  let quoted = false;
  for (let i = 0; i < record.length; i++) {
    const char = record[i];
    if (char === '"') {
      if (quoted && record[i + 1] === '"') { i++; continue; }
      quoted = !quoted;
    } else if (!quoted && counts.has(char)) counts.set(char, counts.get(char)! + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0][0];
}

function quickReplyRecordAccumulator() {
  const rows: QuickReplyImportRow[] = [];
  const invalidRows: number[] = [];
  let delimiter: string | undefined;
  const add = (record: string, index: number) => {
    const fields = splitCsvLine(record, delimiter ??= quickReplyDelimiter(record));
    const [title = "", body = "", category = "", translation = "", parent = ""] = fields;
    if (index === 0 && /^(标题|名称|title|titre|原文|source|original)$/i.test(title) && /^(内容|正文|body|content|contenu|text|原文|source|original|译文|翻译|translation|translated|traduction)$/i.test(body)) return;
    if (fields.length < 2 || fields.length > 5 || !title || (!body && !translation)) {
      invalidRows.push(index + 1); return;
    }
    rows.push({ title, body, category, ...(translation ? { translation } : {}), ...(parent ? { parent } : {}) });
  };
  return { add, result: { rows, invalidRows } };
}

/** Stream delimited files so a large import does not duplicate the entire input in a textarea. */
export async function parseQuickReplyTextFile(file: File) {
  const prefix = await file.slice(0, 4096).text();
  if (/\.json$/i.test(file.name) || prefix.trimStart().startsWith("{")) {
    if (file.size > QUICK_REPLY_TEXT_IMPORT_LIMIT) throw Error("limit");
    return parseQuickReplyTable(await file.text());
  }
  const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
  const accumulator = quickReplyRecordAccumulator();
  let trailing = "", quoted = false, index = 0;
  const add = (record: string) => {
    if (record.length > QUICK_REPLY_TEXT_IMPORT_LIMIT) throw Error("limit");
    if (record.trim()) accumulator.add(record, index++);
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      let start = 0;
      for (let i = 0; i < value.length; i++) {
        if (value[i] === '"') quoted = !quoted;
        else if (value[i] === "\n" && !quoted) {
          add(trailing + value.slice(start, i));
          trailing = "";
          start = i + 1;
        }
      }
      trailing += value.slice(start);
      if (trailing.length > QUICK_REPLY_TEXT_IMPORT_LIMIT) throw Error("limit");
    }
    if (quoted) throw Error("format");
    add(trailing);
    return accumulator.result;
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

export function quickReplyRowsToTsv(rows: readonly (readonly string[])[]) {
  return rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join("\t")).join("\n");
}

export function quickReplySheetRowsWithLinks(
  sheets: readonly { name: string; columns: readonly (readonly unknown[])[]; rowOffset?: number }[],
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
      if (index === 0 && !sheet.rowOffset && ((ORIGINAL_HEADER.test(original) && TRANSLATION_HEADER.test(translation)) || (TRANSLATION_HEADER.test(original) && ORIGINAL_HEADER.test(translation)))) continue;
      if (!original && !translation) continue;
      const titleText = (titleSource === "translation" ? translation : original) || original || translation;
      const title = (titleText.split("\n")[0] || titleText).trim() || titleText;
      const body = original;
      const safeTranslation = translation;
      rows.push([title, body, sheet.name, safeTranslation, groupName]);
      links.push({ spreadsheetId, tab: sheet.name, row: index + 1 + (sheet.rowOffset || 0), originalColumn, translationColumn, titleSnapshot: title, originalSnapshot: original, translationSnapshot: safeTranslation });
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
