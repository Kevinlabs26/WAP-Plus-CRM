/** Preserve phone text and prevent spreadsheet applications from interpreting input as formulas. */
export function escapeCsvCell(value: string, forceText = false): string {
  if (forceText || /^[\s\u0000-\u001f]*[=+\-@＝＋－＠]/u.test(value) || /^[\t\r\n]/.test(value)) value = "'" + value;
  return `"${value.replace(/"/g, '""')}"`;
}
