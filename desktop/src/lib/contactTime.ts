import { getCountries, getCountryCallingCode, parsePhoneNumberFromString } from "libphonenumber-js/min";
import { getCountry } from "countries-and-timezones";
import { displayPhone } from "./utils.ts";
import type { Contact } from "../types/crm.ts";

export function resolvePhoneCountry(contact: Pick<Contact, "phone" | "channelAddress" | "isGroup">) {
  if (contact.isGroup || contact.phone?.endsWith("@g.us") || contact.channelAddress?.endsWith("@g.us")) return;
  const raw = displayPhone(contact.phone) || displayPhone(contact.channelAddress) || contact.phone?.trim();
  if (!raw || raw.length > 64 || !/^\+?[\d\s().-]+$/.test(raw)) return;
  let number = raw.replace(/[\s().-]/g, "").replace(/^\+?00/, "+");
  if (!number.startsWith("+")) number = `+${number}`;
  const parsed = parsePhoneNumberFromString(number, { extract: false });
  if (!parsed?.country) return;
  if (!parsed.isPossible()) {
    // 兼容旧格式的长短变化；仅显示唯一国家区号，不改号码或放宽发送校验。
    if (parsed.nationalNumber.length < 6 || parsed.number.length > 16
      || getCountries().filter(code => getCountryCallingCode(code) === parsed.countryCallingCode).length !== 1) return;
  }
  return getCountry(parsed.country) || { id: parsed.country, name: parsed.country, timezones: [] };
}

export function countryDisplayName(code: string, fallback: string, locale: string) {
  try { return new Intl.DisplayNames([locale], { type: "region" }).of(code) || fallback; }
  catch { return fallback; }
}

/** 以当前日期的实际时差去重；不能拿冬令时偏移代替现在的当地时间。 */
export function countryLocalTimes(timezones: readonly string[], locale: string, now: number) {
  const times = new Map<string, { timeZone: string; timeZones: string[]; label: string; time: string; shortLabel: string; offset: string }>();
  if (!Number.isFinite(now)) return [];
  const here = new Date(now);
  for (const timeZone of timezones) {
    try {
      const formatter = new Intl.DateTimeFormat(locale, {
        timeZone, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "shortOffset",
      });
      const parts = formatter.formatToParts(now);
      const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || "";
      const key = ["year", "month", "day", "hour", "minute"].map(type => part(type as Intl.DateTimeFormatPartTypes)).join("-");
      const time = `${part("hour")}:${part("minute")}`;
      const sameDate = Number(part("year")) === here.getFullYear() && Number(part("month")) === here.getMonth() + 1 && Number(part("day")) === here.getDate();
      const existing = times.get(key);
      if (existing) existing.timeZones.push(timeZone);
      else times.set(key, { timeZone, timeZones: [timeZone], label: formatter.format(now), time, offset: part("timeZoneName"),
        shortLabel: sameDate ? time : `${part("month")}/${part("day")} ${time}` });
    } catch {
      // 系统时区库较旧时跳过不支持的名称，不回退到本机时间冒充对方时间。
    }
  }
  return [...times.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
}
