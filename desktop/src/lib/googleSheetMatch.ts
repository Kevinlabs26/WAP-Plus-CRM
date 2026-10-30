import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/min";

export type SheetSchedule =
  | { kind: "manual" }
  | { kind: "interval"; minutes: number }
  | { kind: "daily"; time: string };

export type SheetColumn = { heading: string } | { position: number };
// A batch has room for 100 ranges; phone numbers and the header reserve two.
export const MAX_SHEET_DISPLAY_COLUMNS = 98;

/** A number without an international prefix is interpreted using the selected region. */
export function sheetPhone(value: string, region?: CountryCode): string | null {
  const input = value.trim();
  if (!input || /[^\d+().\s-]/.test(input) || (input.match(/\+/g)?.length || 0) > 1 || (input.includes("+") && !input.startsWith("+"))) return null;
  const phone = parsePhoneNumberFromString(input, region);
  return phone?.isValid() ? phone.number : null;
}

export function sheetInternationalPhone(value: string): string | null {
  const input = value.trim();
  return sheetPhone(input.startsWith("+") ? input : `+${input}`);
}

/** Resolve by unique heading on every refresh so inserted or reordered columns cannot silently change the mapping. */
export function sheetColumnIndex(headers: readonly string[], heading: string): number | null {
  const matches = headers.flatMap((value, index) => value === heading ? [index] : []);
  return heading && matches.length === 1 ? matches[0] : null;
}

export function resolveSheetColumn(headers: readonly string[], column: SheetColumn): number | null {
  if ("heading" in column) return sheetColumnIndex(headers, column.heading);
  return Number.isInteger(column.position) && column.position >= 0 ? column.position : null;
}

export function matchingSheetRows(rows: readonly (readonly string[])[], phoneColumn: number, phone: string, region?: CountryCode): number[] {
  const target = sheetPhone(phone, region);
  if (!target || !Number.isInteger(phoneColumn) || phoneColumn < 0) return [];
  return rows.flatMap((row, index) => sheetPhone(row[phoneColumn] || "", region) === target ? [index] : []);
}

export function selectedSheetValues(
  headers: readonly string[], rows: readonly (readonly string[])[], phoneColumn: SheetColumn,
  columns: readonly SheetColumn[], phone: string, region?: CountryCode,
): string[][] | null {
  const matchIndex = resolveSheetColumn(headers, phoneColumn);
  const selected = columns.map(column => resolveSheetColumn(headers, column));
  if (matchIndex === null || selected.some(index => index === null)) return null;
  return matchingSheetRows(rows, matchIndex, phone, region).map(row =>
    selected.map(index => rows[row][index!] ?? ""));
}

/** Daily times follow the computer's local time and catch up after reopening. */
export function sheetRefreshDue(schedule: SheetSchedule, lastSuccess: number | null, now: Date): boolean {
  if (schedule.kind === "manual") return false;
  if (schedule.kind === "interval") return Number.isFinite(schedule.minutes) && schedule.minutes > 0 && (!lastSuccess || !Number.isFinite(lastSuccess) || now.getTime() - lastSuccess >= schedule.minutes * 60_000);
  const match = /^(\d{2}):(\d{2})$/.exec(schedule.time);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return false;
  if (!lastSuccess || !Number.isFinite(lastSuccess)) return true;
  const scheduled = new Date(now);
  scheduled.setHours(Number(match[1]), Number(match[2]), 0, 0);
  if (scheduled.getTime() > now.getTime()) scheduled.setDate(scheduled.getDate() - 1);
  return lastSuccess < scheduled.getTime();
}
