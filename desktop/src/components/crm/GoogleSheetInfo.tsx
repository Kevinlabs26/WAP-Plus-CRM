import { useI18n } from "@/i18n";
import { refreshSheets, useGoogleSheets } from "@/lib/googleSheets";
import { sheetInternationalPhone } from "@/lib/googleSheetMatch";
import { sheetErrorHint } from "@/lib/googleSheetErrors";
import type { Contact } from "@/types/crm";

export function GoogleSheetInfo({ contact, open = false }: { contact: Contact; open?: boolean }) {
  const { t } = useI18n();
  const { email, config, data, error, busy } = useGoogleSheets();
  if (!email || !config || contact.isGroup) return null;
  const phone = sheetInternationalPhone(contact.phone);
  return <details open={open || undefined} className="rounded-xl border border-zinc-800 p-2.5">
    <summary className="cursor-pointer text-xs font-medium">{t("sheets.info")}</summary>
    <div className="mt-2 space-y-2 text-xs">
      <div className="flex justify-between gap-2 text-zinc-500"><span className="truncate" title={config.tab}>{config.tab}</span><button className="text-brand" disabled={busy} onClick={() => void refreshSheets(true)}>{t("sheets.refresh")}</button></div>
      {error && <p role="alert" className="text-amber-400">{t("sheets.stale")} {t(sheetErrorHint(error))}</p>}
      {!phone ? <p className="text-zinc-500">{t("sheets.noPhone")}</p> : config.fields.map(field => {
        const cached = data[field.id];
        const values = cached?.values[phone];
        return <div key={field.id} title={cached ? `${t("sheets.updated")} ${new Date(cached.at).toLocaleString()}` : t("sheets.notLoaded")}>
          <div className="text-zinc-500">{field.label}</div>
          {!cached ? <p>{t("sheets.notLoaded")}</p> : !values ? <p>{t("sheets.noMatch")}</p> : values.map((value, index) => <p key={index} className="whitespace-pre-wrap break-words">{values.length > 1 ? `${index + 1}. ` : ""}{value || "—"}</p>)}
        </div>;
      })}
    </div>
  </details>;
}
