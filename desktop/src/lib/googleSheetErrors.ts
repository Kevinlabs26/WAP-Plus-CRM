/** Native errors omit credentials; keep details separate from the localized recovery hint. */
export function sheetErrorHint(error: string) {
  if (/\b401\b|reconnect|refresh.*authorization|not granted|permission was not granted|connect your google/i.test(error)) return "sheets.error.authorize" as const;
  if (/\b403\b/.test(error)) return "sheets.error.forbidden" as const;
  if (/\b404\b|invalid spreadsheet id/i.test(error)) return "sheets.error.notFound" as const;
  if (/\b429\b/.test(error)) return "sheets.error.quota" as const;
  if (/headings changed|duplicat|sheet changed during|invalid column|invalid sheet selection/i.test(error)) return "sheets.error.mapping" as const;
  if (/\b400\b/.test(error)) return "sheets.error.request" as const;
  if (/already running|wait for.*google/i.test(error)) return "sheets.error.busy" as const;
  if (/declined|access_denied|cancelled/i.test(error)) return "sheets.error.cancelled" as const;
  if (/timed out|timeout/i.test(error)) return "sheets.error.timeout" as const;
  if (/network|offline|connection|cannot read google sheets|cannot complete google authorization/i.test(error)) return "sheets.error.network" as const;
  if (/quotaexceeded|disk|storage|indexeddb|cannot save|cannot read google authorization/i.test(error)) return "sheets.error.storage" as const;
  if (/not configured|invalid google.*client|invalid google.*configuration/i.test(error)) return "sheets.error.build" as const;
  if (/\b5\d\d\b/.test(error)) return "sheets.error.service" as const;
  return "sheets.error.other" as const;
}
