import { splitCsvLine } from "./contactImport.ts";
import { MAX_QUICK_REPLIES } from "./quickReplies.ts";

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
  const rows: { title: string; body: string; category: string }[] = [];
  const invalidRows: number[] = [];
  records.forEach((record, index) => {
    const fields = splitCsvLine(record, delimiter);
    const [title = "", body = "", category = ""] = fields;
    if (index === 0 && /^(标题|名称|title|titre)$/i.test(title) && /^(内容|正文|body|content|contenu|text)$/i.test(body)) return;
    if (fields.length < 2 || fields.length > 3 || !title || !body || title.length > 40 || body.length > 2000 || category.length > 32) {
      invalidRows.push(index + 1); return;
    }
    rows.push({ title, body, category });
  });
  if (rows.length > MAX_QUICK_REPLIES) throw new Error("limit");
  return { rows, invalidRows };
}
