import type { Contact } from "../types/crm.ts";
import { resolvePhoneCountry } from "./contactTime.ts";
import { systemTimeZone, validTimeZone } from "./timeZone.ts";

export function resolveAiTimeZones(contact: Contact | undefined, settings: { aiTimeZone?: string }) {
  const configured = validTimeZone(settings.aiTimeZone);
  const sender = { timeZone: configured || systemTimeZone(), source: configured ? "configured" : "computer" };
  const group = contact?.isGroup || contact?.channelAddress?.endsWith("@g.us") || contact?.phone?.endsWith("@g.us");
  if (group) return { sender, recipient: { source: "group_unknown", timeZones: [] as string[] } };
  const confirmed = validTimeZone(contact?.timeZone);
  if (confirmed) return { sender, recipient: { source: "confirmed", timeZones: [confirmed] } };
  const country = contact ? resolvePhoneCountry(contact) : undefined;
  return { sender, recipient: { source: country?.timezones.length ? "phone_country_estimate" : "unknown",
    country: country?.id, timeZones: [...new Set(country?.timezones.filter(zone => validTimeZone(zone)) || [])] } };
}

export function buildAiTimeContext(contact: Contact | undefined, settings: { aiTimeZone?: string }, now = Date.now()): string {
  const zones = resolveAiTimeZones(contact, settings);
  const local = (timeZone: string) => ({ timeZone, dateTime: new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "long",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "longOffset",
  }).format(now) });
  return JSON.stringify({
    currentUtc: new Date(now).toISOString(),
    sender: { source: zones.sender.source, ...(zones.sender.timeZone ? local(zones.sender.timeZone) : { dateTime: "unknown" }) },
    recipient: { ...zones.recipient, localTimes: zones.recipient.timeZones.length === 1 ? zones.recipient.timeZones.map(local) : [] },
  });
}
