import { useAppStore } from "@/store/appStore";
import { Input, SectionLabel } from "@/components/ui/primitives";
import {
  DEFAULT_FOLLOW_UP_RULES,
  DEFAULT_FOLLOW_UP_RULE_SETTINGS,
  type FollowUpRuleSetting,
} from "@/lib/followUpRules";
import { VOICE_INPUT_LANGUAGES } from "@/lib/voiceInputLanguage";
import { useI18n, type TranslationKey } from "@/i18n";

const FOLLOW_UP_I18N: Record<string, { title: TranslationKey; note: TranslationKey }> = {
  inbound_no_reply: { title: "settingsMessaging.rule.inbound.title", note: "settingsMessaging.rule.inbound.note" },
  outbound_no_answer: { title: "settingsMessaging.rule.outbound.title", note: "settingsMessaging.rule.outbound.note" },
  quoting_stale: { title: "settingsMessaging.rule.quoting.title", note: "settingsMessaging.rule.quoting.note" },
};

export function SettingsMessagingPanel() {
  const { t } = useI18n();
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);

  const ruleSettings =
    settings.followUpRuleSettings?.length
      ? settings.followUpRuleSettings
      : DEFAULT_FOLLOW_UP_RULE_SETTINGS;

  const patchRule = (id: string, patch: Partial<FollowUpRuleSetting>) => {
    const next = DEFAULT_FOLLOW_UP_RULE_SETTINGS.map((base) => {
      const cur = ruleSettings.find((r) => r.id === base.id) || base;
      if (cur.id !== id) return cur;
      return { ...cur, ...patch, id: cur.id };
    });
    updateSettings({ followUpRuleSettings: next });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h3 className="text-lg font-semibold text-zinc-100">{t("settingsMessaging.title")}</h3>
        <p className="mt-1 text-[11px] text-zinc-500">
          {t("settingsMessaging.description")}
        </p>
      </header>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
        <div className="flex items-center justify-between gap-3">
          <SectionLabel>{t("settingsMessaging.rateLimit")}</SectionLabel>
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-zinc-300">
            <input
              type="checkbox"
              className="rounded border-zinc-600"
              checked={settings.rateLimitEnabled !== false}
              onChange={(e) =>
                updateSettings({ rateLimitEnabled: e.target.checked })
              }
            />
            {t("common.enable")}
          </label>
        </div>
        <p className="mt-2 text-[11px] text-zinc-600">
          {t("settingsMessaging.rateLimitHint")}
        </p>
        <div
          className={
            settings.rateLimitEnabled === false
              ? "pointer-events-none opacity-40"
              : ""
          }
        >
          <div className="mt-3 grid grid-cols-3 gap-3">
            <NumberSetting
              label={t("settingsMessaging.perMinute")}
              value={settings.ratePerMinute ?? 8}
              onChange={(value) =>
                updateSettings({ ratePerMinute: Math.max(1, value || 8) })
              }
            />
            <NumberSetting
              label={t("settingsMessaging.perHour")}
              value={settings.ratePerHour ?? 80}
              onChange={(value) =>
                updateSettings({ ratePerHour: Math.max(1, value || 80) })
              }
            />
            <NumberSetting
              label={t("settingsMessaging.minInterval")}
              value={settings.rateMinIntervalSec ?? 4}
              onChange={(value) =>
                updateSettings({ rateMinIntervalSec: Math.max(0, value || 0) })
              }
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <NumberSetting
              label={t("settingsMessaging.jitter")}
              value={settings.rateJitterSec ?? 2}
              onChange={(value) =>
                updateSettings({
                  rateJitterSec: Math.min(30, Math.max(0, value || 0)),
                })
              }
            />
            <NumberSetting
              label={t("settingsMessaging.globalGap")}
              value={settings.globalMinGapSec ?? 2}
              onChange={(value) =>
                updateSettings({
                  globalMinGapSec: Math.min(60, Math.max(0, value || 0)),
                })
              }
            />
          </div>
        </div>
        {settings.rateLimitEnabled === false && (
          <p className="mt-3 text-[11px] text-amber-300/80">
            {t("settingsMessaging.rateLimitOff")}
          </p>
        )}
        <label className="mt-4 flex cursor-pointer items-start gap-2 text-[12px] text-zinc-300">
          <input
            type="checkbox"
            className="mt-0.5 rounded border-zinc-600"
            checked={settings.blockSendWhenOverheated !== false}
            onChange={(e) =>
              updateSettings({ blockSendWhenOverheated: e.target.checked })
            }
          />
          <span>
            <span className="font-medium">{t("settingsMessaging.blockOverheated")}</span>
            <span className="mt-0.5 block text-2xs leading-4 text-zinc-600">
              {t("settingsMessaging.blockOverheatedHint")}
            </span>
          </span>
        </label>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
        <SectionLabel>{t("settingsMessaging.notifications")}</SectionLabel>
        <p className="mt-2 text-[11px] text-zinc-600">
          {t("settingsMessaging.notificationsHint")}
        </p>
        <label className="mt-3 flex cursor-pointer items-start gap-2 text-[12px] text-zinc-300">
          <input
            type="checkbox"
            className="mt-0.5 rounded border-zinc-600"
            checked={settings.desktopNotifyEnabled !== false}
            onChange={(e) => {
              updateSettings({ desktopNotifyEnabled: e.target.checked });
              if (e.target.checked) {
                void import("@/lib/desktopNotify").then((m) =>
                  m.ensureNotifyPermission()
                );
              }
            }}
          />
          <span>
            <span className="font-medium">{t("settingsMessaging.newMessageNotification")}</span>
            <span className="mt-0.5 block text-2xs leading-4 text-zinc-600">
              {t("settingsMessaging.newMessageNotificationHint")}
            </span>
          </span>
        </label>

        <div
          className={
            settings.desktopNotifyEnabled === false
              ? "mt-3 space-y-2 opacity-40 pointer-events-none"
              : "mt-3 space-y-2"
          }
        >
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-zinc-300">
            <input
              type="checkbox"
              className="rounded border-zinc-600"
              checked={settings.notifyFollowUpEnabled !== false}
              onChange={(e) =>
                updateSettings({ notifyFollowUpEnabled: e.target.checked })
              }
            />
            <span className="font-medium">{t("settingsMessaging.followUpNotification")}</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-zinc-300">
            <input
              type="checkbox"
              className="rounded border-zinc-600"
              checked={settings.notifyGroupMessagesEnabled === true}
              onChange={(e) =>
                updateSettings({ notifyGroupMessagesEnabled: e.target.checked })
              }
            />
            <span className="font-medium">{t("settingsMessaging.groupNotification")}</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-zinc-300">
            <input
              type="checkbox"
              className="rounded border-zinc-600"
              checked={settings.autoReadGroupMessages === true}
              onChange={(e) =>
                updateSettings({ autoReadGroupMessages: e.target.checked })
              }
            />
            <span className="font-medium">{t("settingsMessaging.autoReadGroups")}</span>
          </label>
          <p className="text-[11px] text-zinc-600">
            {t("settingsMessaging.autoReadGroupsHint")}
          </p>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <SectionLabel>{t("settingsMessaging.autoFollowUp")}</SectionLabel>
            <p className="mt-2 text-[11px] text-zinc-600">
              {t("settingsMessaging.autoFollowUpHint")}
            </p>
          </div>
          <label className="flex shrink-0 cursor-pointer items-center gap-2 text-[12px] text-zinc-300">
            <input
              type="checkbox"
              className="rounded border-zinc-600"
              checked={settings.autoFollowUpEnabled !== false}
              onChange={(e) =>
                updateSettings({ autoFollowUpEnabled: e.target.checked })
              }
            />
            {t("common.enable")}
          </label>
        </div>

        <ul
          className={
            settings.autoFollowUpEnabled === false
              ? "mt-3 space-y-2 opacity-40 pointer-events-none"
              : "mt-3 space-y-2"
          }
        >
          {DEFAULT_FOLLOW_UP_RULES.map((rule) => {
            const s =
              ruleSettings.find((r) => r.id === rule.id) ||
              DEFAULT_FOLLOW_UP_RULE_SETTINGS.find((r) => r.id === rule.id)!;
            return (
              <li
                key={rule.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5"
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-[12px] text-zinc-200">
                  <input
                    type="checkbox"
                    className="rounded border-zinc-600"
                    checked={s.enabled !== false}
                    onChange={(e) =>
                      patchRule(rule.id, { enabled: e.target.checked })
                    }
                  />
                  <span className="min-w-0">
                    <span className="font-medium">{t(FOLLOW_UP_I18N[rule.id].title)}</span>
                    <span className="mt-0.5 block text-2xs text-zinc-600">
                      {t(FOLLOW_UP_I18N[rule.id].note, { hours: s.afterHours })}
                    </span>
                  </span>
                </label>
                <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                  {t("settingsMessaging.timeout")}
                  <Input
                    type="number"
                    min={1}
                    max={168}
                    size="sm"
                    value={s.afterHours}
                    disabled={s.enabled === false}
                    onChange={(e) =>
                      patchRule(rule.id, {
                        afterHours: Math.max(
                          1,
                          Math.min(168, Number(e.target.value) || 1)
                        ),
                      })
                    }
                    className="w-16 text-center text-[12px]"
                  />
                  {t("settingsMessaging.hours")}
                </label>
              </li>
            );
          })}
        </ul>
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
    </div>
  );
}

function NumberSetting({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block text-2xs text-zinc-500">
      {label}
      <Input
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1"
      />
    </label>
  );
}
