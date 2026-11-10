import { MAX_QUICK_REPLIES } from "./quickReplies.ts";

export type QuickReplyWorkbookSheet = {
  name: string;
  columns: { index: number; label: string }[];
  rows: string[][];
  sendColumn: number;
  translationColumn: number | null;
  titleColumn: number | null;
};

const MAX_WORKBOOK_BYTES = 10 * 1024 * 1024;
const MAX_WORKBOOK_SHEETS = 50;
const MAX_WORKBOOK_COLUMNS = 26;

const columnName = (index: number) => {
  let value = index + 1;
  let name = "";
  while (value) {
    value--;
    name = String.fromCharCode(65 + value % 26) + name;
    value = Math.floor(value / 26);
  }
  return name;
};

const cellText = (value: unknown) => String(value ?? "").trim().slice(0, 2000);

function headerColumn(headers: string[], patterns: RegExp[]) {
  return headers.findIndex(value => patterns.some(pattern => pattern.test(value.trim().toLocaleLowerCase())));
}

/** Read workbook values only; formulas are never evaluated. */
export async function readQuickReplyWorkbook(file: File): Promise<QuickReplyWorkbookSheet[]> {
  if (!file.size || file.size > MAX_WORKBOOK_BYTES) throw new Error("limit");
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", sheetRows: MAX_QUICK_REPLIES + 2 });
  if (!workbook.SheetNames.length || workbook.SheetNames.length > MAX_WORKBOOK_SHEETS) throw new Error("limit");

  let totalRows = 0;
  return workbook.SheetNames.map(name => {
    const worksheet = workbook.Sheets[name];
    const values = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
    });
    const allRows = values.map(row => row.map(cellText));
    const headers = allRows[0] || [];
    const sendHeader = headerColumn(headers, [/^(原文|内容|话术|发送内容|body|text|source|original|reply|message)$/i]);
    const translationHeader = headerColumn(headers, [/^(翻译|译文|translation|translate|target)$/i]);
    const titleHeader = headerColumn(headers, [/^(标题|名称|title|name|label)$/i]);
    const hasHeader = sendHeader >= 0 || translationHeader >= 0 || titleHeader >= 0;
    const rows = allRows.slice(hasHeader ? 1 : 0).filter(row => row.some(Boolean));
    totalRows += rows.length;
    if (totalRows > MAX_QUICK_REPLIES) throw new Error("limit");

    const columnCount = Math.min(MAX_WORKBOOK_COLUMNS, Math.max(2, ...allRows.map(row => row.length)));
    const columns = Array.from({ length: columnCount }, (_, index) => ({
      index,
      label: `${columnName(index)}${hasHeader && headers[index] ? ` · ${headers[index]}` : ""}`,
    }));
    const sendColumn = sendHeader >= 0 ? sendHeader : 0;
    const translationColumn = translationHeader >= 0
      ? translationHeader
      : columnCount > 1 ? (sendColumn === 0 ? 1 : 0) : null;
    return {
      name: name.trim().slice(0, 32) || "其他",
      columns,
      rows,
      sendColumn,
      translationColumn: translationColumn === sendColumn ? null : translationColumn,
      titleColumn: titleHeader >= 0 && titleHeader !== sendColumn && titleHeader !== translationColumn ? titleHeader : null,
    };
  });
}
