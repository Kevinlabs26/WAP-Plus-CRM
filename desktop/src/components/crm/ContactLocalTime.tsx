import { ChevronDown, Clock, MapPin } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Contact } from "@/types/crm";
import { useI18n } from "@/i18n";
import { countryDisplayName, countryLocalTimes, resolvePhoneCountry } from "@/lib/contactTime";

export function ContactLocalTime({ contact }: { contact: Contact }) {
  const { locale, t } = useI18n();
  const country = useMemo(() => resolvePhoneCountry(contact), [contact.phone, contact.channelAddress, contact.isGroup]);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!country) return;
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

  if (times.length <= 1) return (
    <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-2xs text-zinc-500" title={`${hint}\n${times[0]?.label || ""}`}>
      {countryLabel}
      {times[0] && <><Clock aria-hidden="true" className="ml-1 h-3 w-3 shrink-0" /><span className="tabular-nums">{times[0].shortLabel}</span></>}
      <span className="text-zinc-600">{t("contactTime.reference")}</span>
    </div>
  );
  return (
    <details key={country.id} className="group mt-1 text-2xs text-zinc-500">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand" title={hint}>
        {countryLabel}
        <Clock aria-hidden="true" className="ml-1 h-3 w-3 shrink-0" />
        <span className="tabular-nums">{times.length === 2 ? times.map(time => time.shortLabel).join(" / ") : t("contactTime.timeCount", { count: times.length })}</span>
        <span className="text-zinc-600">{t("contactTime.multiple")}</span>
        <ChevronDown aria-hidden="true" className="h-3 w-3 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-1.5 space-y-1 rounded-md border border-zinc-800 bg-zinc-900/30 p-2">
        {times.map(time => <div key={time.timeZone} className="tabular-nums">{time.label}</div>)}
        <p className="pt-1 leading-4 text-zinc-600">{hint}</p>
      </div>
    </details>
  );
}
