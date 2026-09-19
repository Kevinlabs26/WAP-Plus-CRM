import { useAppStore } from "@/store/appStore";
import { Input, SectionLabel } from "@/components/ui/primitives";
import { BaileysConnectCard } from "./BaileysConnectCard";
import { AccountHealthPanel } from "@/components/crm/AccountHealthPanel";
import { useI18n } from "@/i18n";

export function SettingsConnectionPanel() {
  const { t } = useI18n();
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h3 className="text-lg font-semibold text-zinc-100">{t("settingsConnection.title")}</h3>
        <p className="mt-1 text-[11px] text-zinc-500">{t("settingsConnection.description")}</p>
      </header>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
        <AccountHealthPanel />
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
        <SectionLabel>{t("settingsConnection.channel")}</SectionLabel>
        <label className="mt-3 block text-2xs text-zinc-500">
          {t("settingsConnection.currentChannel")}
          <select
            value={settings.sendChannel === "android_bridge" ? "android_bridge" : "baileys"}
            onChange={(event) => updateSettings({
              sendChannel: event.target.value === "android_bridge" ? "android_bridge" : "baileys",
            })}
            className="ui-control mt-1 w-full px-2.5 text-[13px]"
          >
            <option value="baileys">{t("settingsConnection.baileys")}</option>
            <option value="android_bridge">{t("settingsConnection.bridge")}</option>
          </select>
        </label>

        {settings.sendChannel !== "android_bridge" ? (
          <div className="mt-3"><BaileysConnectCard /></div>
        ) : (
          <div className="mt-3 space-y-3">
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2.5 text-[11px] leading-relaxed text-amber-100/90">
              <p className="font-medium text-amber-200">{t("settingsConnection.bridgeWarning")}</p>
              <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-amber-100/75">
                <li>
                  <strong className="font-medium text-amber-100">{t("settingsConnection.canDoTitle")}</strong>
                  {t("settingsConnection.canDo")}
                </li>
                <li>
                  <strong className="font-medium text-amber-100">{t("settingsConnection.limitsTitle")}</strong>
                  {t("settingsConnection.limits")}
                </li>
                <li>{t("settingsConnection.previewNote")}</li>
                <li>{t("settingsConnection.recommendation")}</li>
              </ul>
            </div>
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
              <label className="block text-2xs text-zinc-500">
                Host
                <Input value={settings.bridgeHost} onChange={(event) => updateSettings({ bridgeHost: event.target.value })} className="mt-1" />
              </label>
              <label className="block text-2xs text-zinc-500">
                Port
                <Input type="number" value={settings.bridgePort} onChange={(event) => updateSettings({ bridgePort: Number(event.target.value) || 17890 })} className="mt-1" />
              </label>
              <label className="col-span-2 block text-2xs text-zinc-500">
                {t("settingsConnection.token")}
                <Input
                  type="password"
                  autoComplete="off"
                  value={settings.bridgeToken}
                  onChange={(event) => updateSettings({ bridgeToken: event.target.value })}
                  placeholder={t("settingsConnection.tokenPlaceholder")}
                  className="mt-1 font-mono"
                />
              </label>
              <p className="col-span-2 text-2xs text-zinc-600">
                {t("settingsConnection.tokenHint")}
              </p>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
        <SectionLabel>{t("settingsConnection.behavior")}</SectionLabel>
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-[12px] text-zinc-300">
          <input
            type="checkbox"
            checked={settings.autoConnectBridge}
            onChange={(event) => updateSettings({ autoConnectBridge: event.target.checked })}
            className="rounded border-zinc-600"
          />
          {t("settingsConnection.autoConnect")}
        </label>
        <p className="mt-1 text-2xs text-zinc-600">{t("settingsConnection.autoConnectHint")}</p>
      </section>
    </div>
  );
}
