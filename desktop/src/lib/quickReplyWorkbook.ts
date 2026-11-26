export type QuickReplyWorkbookSheet = {
  name: string;
  columns: { index: number; label: string }[];
  rows: string[][];
  sendColumn: number;
  translationColumn: number | null;
  titleColumn: number | null;
};

export const MAX_WORKBOOK_BYTES = 10 * 1024 * 1024;

export const quickReplyColumnName = (index: number) => {
  let value = index + 1;
  let name = "";
  while (value) {
    value--;
    name = String.fromCharCode(65 + value % 26) + name;
    value = Math.floor(value / 26);
  }
  return name;
};

export function quickReplyColumnIndex(name: string) {
  if (!/^[A-Z]{1,3}$/i.test(name.trim())) return -1;
  return [...name.trim().toUpperCase()].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function headerColumn(headers: string[], patterns: RegExp[]) {
  return headers.findIndex(value => patterns.some(pattern => pattern.test(value || "")));
}

/** Read workbook values only; formulas are never evaluated. */
export async function readQuickReplyWorkbook(file: File): Promise<QuickReplyWorkbookSheet[]> {
  if (!file.size || file.size > MAX_WORKBOOK_BYTES) throw new Error("limit");
  const XLSX = await import("xlsx");
  return parseQuickReplyWorkbook(await file.arrayBuffer(), XLSX);
}

export function parseQuickReplyWorkbook(bytes: ArrayBuffer, XLSX: typeof import("xlsx")): QuickReplyWorkbookSheet[] {
  if (!bytes.byteLength || bytes.byteLength > MAX_WORKBOOK_BYTES) throw new Error("limit");
  const workbook = XLSX.read(bytes, { type: "array" });
  if (!workbook.SheetNames.length) throw new Error("format");

  return workbook.SheetNames.map(name => {
    const worksheet = workbook.Sheets[name];
    const rowsByNumber = new Map<number, string[]>();
    const usedColumns = new Set<number>();
    for (const [key, cell] of Object.entries(worksheet)) {
      if (!/^[A-Z]+[1-9]\d*$/.test(key) || !cell || typeof cell !== "object" || cell.t === "e" || cell.v == null) continue;
      const value = XLSX.utils.format_cell(cell).trim();
      if (!value) continue;
      const { r, c } = XLSX.utils.decode_cell(key);
      const row = rowsByNumber.get(r) || [];
      row[c] = value;
      rowsByNumber.set(r, row);
      usedColumns.add(c);
    }
    const allRows = [...rowsByNumber].sort(([a], [b]) => a - b).map(([, row]) => row);
    const headers = allRows[0] || [];
    const sendHeader = headerColumn(headers, [/^(原文|内容|话术|发送内容|body|text|source|original|reply|message)$/i]);
    const translationHeader = headerColumn(headers, [/^(翻译|译文|translation|translate|target)$/i]);
    const titleHeader = headerColumn(headers, [/^(标题|名称|title|name|label)$/i]);
    const hasHeader = sendHeader >= 0 || translationHeader >= 0 || titleHeader >= 0;
    const rows = allRows.slice(hasHeader ? 1 : 0);

    const indexes = [...usedColumns].sort((a, b) => a - b);
    const columns = indexes.map(index => ({
      index,
      label: `${quickReplyColumnName(index)}${hasHeader && headers[index] ? ` · ${headers[index]}` : ""}`,
    }));
    const sendColumn = sendHeader >= 0 ? sendHeader : indexes.find(index => index !== titleHeader && index !== translationHeader) ?? 0;
    const translationColumn = translationHeader >= 0
      ? translationHeader
      : !hasHeader ? indexes.find(index => index !== sendColumn) ?? null : null;
    return {
      name: name.trim() || "其他",
      columns,
      rows,
      sendColumn,
      translationColumn: translationColumn === sendColumn ? null : translationColumn,
      titleColumn: titleHeader >= 0 && titleHeader !== sendColumn && titleHeader !== translationColumn ? titleHeader : null,
    };
  });
}

export function quickReplyWorkbookRows(sheets: QuickReplyWorkbookSheet[]) {
  return sheets.flatMap(sheet => sheet.rows.flatMap(row => {
    const body = row[sheet.sendColumn] || "";
    const translation = sheet.translationColumn === null ? "" : row[sheet.translationColumn] || "";
    if (!body && !translation) return [];
    const explicitTitle = sheet.titleColumn === null ? "" : row[sheet.titleColumn] || "";
    const title = (explicitTitle || (body || translation).split(/\r?\n/, 1)[0]);
    return [{ title, body, category: sheet.name, ...(translation ? { translation } : {}) }];
  }));
}
