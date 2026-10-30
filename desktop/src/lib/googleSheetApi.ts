const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets/";

export function spreadsheetId(input: string): string | null {
  const value = input.trim();
  if (/^[a-zA-Z0-9_-]+$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "docs.google.com") return null;
    return /^\/spreadsheets\/d\/([a-zA-Z0-9_-]+)(?:\/|$)/.exec(url.pathname)?.[1] || null;
  } catch { return null; }
}

async function readGoogleSheet(path: string, accessToken: string, signal?: AbortSignal): Promise<any> {
  if (!accessToken) throw new Error("Google authorization required");
  const response = await fetch(SHEETS_API + path, { headers: { Authorization: `Bearer ${accessToken}` }, signal });
  if (!response.ok) throw new Error(`Google Sheets request failed (${response.status})`);
  return response.json();
}

export async function getSheetTabs(id: string, accessToken: string, signal?: AbortSignal): Promise<{ id: number; title: string }[]> {
  const validId = spreadsheetId(id);
  if (!validId) throw new Error("Invalid spreadsheet ID");
  const result = await readGoogleSheet(`${validId}?fields=sheets.properties(sheetId,title)`, accessToken, signal);
  return (result.sheets || []).map((sheet: any) => sheet.properties).filter((item: any) => Number.isInteger(item?.sheetId) && typeof item.title === "string").map((item: any) => ({ id: item.sheetId, title: item.title }));
}

function columnName(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= 18278) throw new Error("Invalid column index");
  let number = index + 1, name = "";
  while (number > 0) { number--; name = String.fromCharCode(65 + number % 26) + name; number = Math.floor(number / 26); }
  return name;
}

export async function getSheetColumns(id: string, tab: string, columns: readonly number[], accessToken: string, signal?: AbortSignal): Promise<string[][]> {
  const validId = spreadsheetId(id);
  if (!validId || !tab || !columns.length) throw new Error("Invalid sheet selection");
  const params = new URLSearchParams({ majorDimension: "COLUMNS", valueRenderOption: "FORMATTED_VALUE" });
  const escapedTab = `'${tab.replace(/'/g, "''")}'`;
  for (const index of columns) { const name = columnName(index); params.append("ranges", `${escapedTab}!${name}:${name}`); }
  const result = await readGoogleSheet(`${validId}/values:batchGet?${params}`, accessToken, signal);
  if (!Array.isArray(result.valueRanges) || result.valueRanges.length !== columns.length) throw new Error("Invalid Google Sheets response");
  return result.valueRanges.map((range: any) => (range.values?.[0] || []).map((value: unknown) => String(value ?? "")));
}
