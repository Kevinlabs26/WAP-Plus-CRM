import { getAllTimezones } from "countries-and-timezones";

export function validTimeZone(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 80 || !value.trim()) return;
  try {
    const zone = value.trim();
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone;
  } catch { return; }
}

export function systemTimeZone(): string | undefined {
  try { return validTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone); }
  catch { return; }
}

let supportedZones: string[] | undefined;
export function timeZoneOptions() {
  return supportedZones ??= [...new Set(["UTC", ...Object.keys(getAllTimezones())])].filter(zone => validTimeZone(zone)).sort();
}
