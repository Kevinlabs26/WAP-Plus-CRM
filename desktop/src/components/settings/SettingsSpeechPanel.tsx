import { useAppStore } from "@/store/appStore";
import { Input, SectionLabel } from "@/components/ui/primitives";
import { useI18n } from "@/i18n";
import { VOICE_INPUT_LANGUAGES } from "@/lib/voiceInputLanguage";
import { TRANSCRIPTION_DEFAULTS, type TranscriptionProvider } from "@/lib/transcriptionConfig";
import { SettingsLocalSpeechPanel } from "./SettingsLocalSpeechPanel";

export function SettingsSpeechPanel() {
 const { t } = useI18n();
 const settings = useAppStore(s => s.settings);
 const updateSettings = useAppStore(s => s.updateSettings);
 return <div className="mx-auto max-w-3xl space-y-6">
 <header><h3 className="text-lg font-semibold text-zinc-100">{t("settings.localSpeech")}</h3><p className="mt-1 text-xs leading-5 text-zinc-500">{t("settings.localSpeechDesc")}</p></header>
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
        <SectionLabel>{t("settingsMessaging.voiceInput")}</SectionLabel>
        <p className="mt-2 text-[11px] text-zinc-600">
          {t("settingsMessaging.voiceInputHint")}
        </p>
        <label className="mt-3 block max-w-sm text-2xs text-zinc-500">
          {t("settingsMessaging.spokenLanguage")}
          <select
            value={settings.voiceInputLang || ""}
            onChange={(event) =>
              updateSettings({ voiceInputLang: event.target.value })
            }
            className="ui-control mt-1 w-full px-2.5 text-[13px]"
          >
            {VOICE_INPUT_LANGUAGES.map((language) => (
              <option key={language.value || "auto"} value={language.value}>
                {language.value
                  ? language.label
                  : t("settingsMessaging.voiceLanguageAuto")}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-3 block max-w-sm text-2xs text-zinc-500">
          {t("settingsMessaging.recognitionEngine")}
          <select
            value={settings.voiceInputEngine || "auto"}
            onChange={(event) =>
              updateSettings({
                voiceInputEngine: event.target
                  .value as typeof settings.voiceInputEngine,
              })
            }
            className="ui-control mt-1 w-full px-2.5 text-[13px]"
          >
            <option value="auto">{t("settingsMessaging.engineAuto")}</option>
            <option value="browser">{t("settingsMessaging.engineBrowser")}</option>
            <option value="ai">{t("settingsMessaging.engineAi")}</option>
          </select>
        </label>
      </section>
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
        <SectionLabel>{t("settingsAi.speechService")}</SectionLabel>
        <p className="mt-2 text-xs leading-relaxed text-zinc-500">{t("settingsAi.speechHint")}</p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-2xs text-zinc-500 sm:col-span-2">
            {t("settingsAi.speechProvider")}
            <select value={settings.transcriptionProvider} className="ui-control mt-1 w-full px-2.5 text-[13px]"
              onChange={(event) => {
                const provider = event.target.value as TranscriptionProvider;
                updateSettings({ transcriptionProvider: provider, transcriptionApiKey: "",
                  transcriptionBaseUrl: TRANSCRIPTION_DEFAULTS[provider].baseUrl,
                  transcriptionModel: TRANSCRIPTION_DEFAULTS[provider].model });
              }}>
              <option value="none">{t("settingsAi.speechDisabled")}</option>
              <option value="openai">OpenAI</option>
              <option value="groq">Groq</option>
              <option value="gemini">Gemini</option>
              <option value="custom">{t("settingsAi.provider.custom")}</option>
            </select>
          </label>
          {settings.transcriptionProvider !== "none" && <>
            {settings.transcriptionProvider !== "gemini" && <label className="block text-2xs text-zinc-500 sm:col-span-2">
              {t("settingsAi.speechBaseUrl")}
              <Input value={settings.transcriptionBaseUrl} onChange={(event) => updateSettings({ transcriptionBaseUrl: event.target.value })} className="mt-1" placeholder="https://your-speech-service.example/v1" />
            </label>}
            <label className="block text-2xs text-zinc-500">{t("settingsAi.speechKey")}<Input type="password" autoComplete="off" className="mt-1" value={settings.transcriptionApiKey} onChange={e => updateSettings({ transcriptionApiKey: e.target.value })} /></label>
            <label className="block text-2xs text-zinc-500">
              {t("settingsAi.speechModel")}
              <Input value={settings.transcriptionModel} onChange={(event) => updateSettings({ transcriptionModel: event.target.value })} className="mt-1" placeholder={TRANSCRIPTION_DEFAULTS[settings.transcriptionProvider].model || "whisper-large-v3"} />
            </label>
          </>}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-zinc-500">{t("settingsAi.speechLocalHint")}</p>
      </section>
<SettingsLocalSpeechPanel embedded />
 </div>;
}
