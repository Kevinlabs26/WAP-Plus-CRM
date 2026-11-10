import { useAppStore } from "@/store/appStore";
import { SectionLabel } from "@/components/ui/primitives";
import { useI18n } from "@/i18n";
import { AiServiceFields } from "./SettingsAiPanel";
import { getTranslationSettings, translationSettingsPatch } from "@/lib/translationConfig";

export function SettingsTranslationPanel() {
  const { t } = useI18n();
  const settings = useAppStore(state => state.settings);
  const updateSettings = useAppStore(state => state.updateSettings);
  return <div className="mx-auto max-w-3xl space-y-6">
    <header><h3 className="text-lg font-semibold text-zinc-100">{t("settingsTranslation.title")}</h3><p className="mt-1 text-xs text-zinc-500">{t("settingsTranslation.description")}</p></header>
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
      <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 block text-2xs text-zinc-500">
            {t("settingsAi.translationService")}
            <select
              value={settings.translateService}
              onChange={(event) => updateSettings({ translateService: event.target.value as typeof settings.translateService })}
              className="ui-control mt-1 w-full px-2.5 text-[13px]"
            >
              <option value="auto">{t("settingsAi.translation.auto")}</option>
              <option value="google">{t("settingsAi.translation.google")}</option>
              <option value="ai">{t("settingsAi.translation.ai")}</option>
            </select>
          </label>
      </div>
      {settings.translateService !== "google" && <AiServiceFields allowMuse={false} showMockHint={false} settings={getTranslationSettings(settings)} updateSettings={patch => updateSettings(translationSettingsPatch(patch))} />}
    </section>
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
<SectionLabel>{t("settings.translation")}</SectionLabel>
<div className="mt-3 grid grid-cols-2 gap-3">

          <label className="col-span-2 block text-2xs text-zinc-500">
            {t("settingsAi.myLanguage")}
            <select
              value={settings.myLang || ""}
              onChange={(event) => updateSettings({ myLang: event.target.value })}
              className="ui-control mt-1 w-full px-2.5 text-[13px]"
            >
              <option value="">{t("settingsAi.autoDetectLanguage")}</option>
              <option value="zh">中文</option>
              <option value="en">English</option>
              <option value="fr">Français</option>
              <option value="es">Español</option>
              <option value="de">Deutsch</option>
              <option value="pt">Português</option>
              <option value="ru">Русский</option>
              <option value="ar">العربية</option>
              <option value="ja">日本語</option>
              <option value="ko">한국어</option>
            </select>
          </label>
</div>
      </section>
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
        <SectionLabel>{t("settingsMessaging.inputTranslation")}</SectionLabel>
        <p className="mt-2 text-[11px] text-zinc-600">
          {t("settingsMessaging.inputTranslationHint")}
        </p>
        <label className="mt-3 block max-w-sm text-2xs text-zinc-500">
          {t("settingsMessaging.defaultTargetLanguage")}
          <select
            value={settings.translateTargetLang || "en"}
            onChange={(event) =>
              updateSettings({ translateTargetLang: event.target.value })
            }
            className="ui-control mt-1 w-full px-2.5 text-[13px]"
          >
            <option value="en">English</option>
            <option value="zh">中文</option>
            <option value="fr">Français</option>
            <option value="es">Español</option>
            <option value="de">Deutsch</option>
            <option value="pt">Português</option>
            <option value="ru">Русский</option>
            <option value="ar">العربية</option>
            <option value="ja">日本語</option>
            <option value="ko">한국어</option>
          </select>
        </label>
      </section>
  </div>;
}
