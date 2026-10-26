import { ChevronDown, Clock, MapPin } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import type { Contact } from "@/types/crm";
import { useI18n } from "@/i18n";
import { useAppStore } from "@/store/appStore";
import { countryDisplayName, countryLocalTimes, resolvePhoneCountry } from "@/lib/contactTime";

export function ContactLocalTime({ contact }: { contact: Contact }) {
  const { locale, t } = useI18n();
  const groupId = useId();
  const updateContact = useAppStore(state => state.updateContact);
  const country = useMemo(() => resolvePhoneCountry(contact), [contact.phone, contact.channelAddress, contact.isGroup]);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!country?.timezones.length) return;
    let timer: number;
    const refresh = () => {
      window.clearTimeout(timer);
      setNow(Date.now());
      timer = window.setTimeout(refresh, 60_000 - Date.now() % 60_000 + 20);
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [country]);
  const times = useMemo(() => country ? countryLocalTimes(country.timezones, locale, now) : [], [country, locale, now]);
  if (!country) return null;
  const name = countryDisplayName(country.id, country.name, locale);
  const countryLabel = <><MapPin aria-hidden="true" className="h-3 w-3 shrink-0" /><span>{name}</span></>;
  const hint = t("contactTime.hint");
  const preferred = times.find(time => time.timeZones.includes(contact.timeZone || ""));
  const choose = (timeZone: string | undefined, element: HTMLElement) => {
    updateContact(contact.id, { timeZone });
    const details = element.closest("details");
    if (details) details.open = false;
  };

  if (country.timezones.length <= 1 || !times.length) return (
    <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-2xs text-zinc-500" title={`${hint}\n${times[0]?.label || ""}`}>
      {countryLabel}
      {times[0] && <><Clock aria-hidden="true" className="ml-1 h-3 w-3 shrink-0" /><span className="tabular-nums">{times[0].shortLabel}</span></>}
    </div>
  );
  return (
    <details key={`${contact.id}:${country.id}`} className="group mt-1 text-2xs text-zinc-500">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand" title={hint}>
        {countryLabel}
        <Clock aria-hidden="true" className="ml-1 h-3 w-3 shrink-0" />
        <span className="tabular-nums">{preferred ? preferred.shortLabel : times.length <= 2 ? times.map(time => time.shortLabel).join(" / ") : t("contactTime.timeCount", { count: times.length })}</span>
        {!preferred && times.length > 1 && <span className="text-zinc-600">{t("contactTime.multiple")}</span>}
        <ChevronDown aria-hidden="true" className="h-3 w-3 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div role="group" aria-label={t("contactTime.choose")} className="mt-1.5 max-h-48 space-y-1 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-900/30 p-2">
        <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-zinc-800/40">
          <input type="radio" name={`${groupId}-${contact.id}`} checked={!preferred} onChange={event => choose(undefined, event.currentTarget)} className="accent-brand" />
          <span>{t("contactTime.automatic")}</span>
        </label>
        {times.flatMap(time => time.timeZones.map(zone => (
          <label key={zone} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-zinc-800/40" title={zone}>
            <input type="radio" name={`${groupId}-${contact.id}`} checked={contact.timeZone === zone} onChange={event => choose(zone, event.currentTarget)} className="accent-brand" />
            <span className="tabular-nums">{time.shortLabel} · {time.offset}{country.timezones.length > 2 ? ` · ${zone.split("/").pop()?.replaceAll("_", " ")}` : ""}</span>
          </label>
        )))}
      </div>
    </details>
  );
}
