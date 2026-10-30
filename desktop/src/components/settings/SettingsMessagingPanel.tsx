import { useAppStore } from "@/store/appStore";
import { SectionLabel } from "@/components/ui/primitives";
import { SettingsNumberInput } from "./SettingsNumberInput";
import {
  DEFAULT_FOLLOW_UP_RULES,
  DEFAULT_FOLLOW_UP_RULE_SETTINGS,
  type FollowUpRuleSetting,
} from "@/lib/followUpRules";
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
        <fieldset disabled={settings.rateLimitEnabled === false}
          className={
            settings.rateLimitEnabled === false
              ? "opacity-40"
              : ""
          }
        >
          <div className="mt-3 grid grid-cols-3 gap-3">
            <NumberSetting
              label={t("settingsMessaging.perMinute")}
              min={1} integer
              value={settings.ratePerMinute ?? 8}
              onChange={(value) =>
                updateSettings({ ratePerMinute: Math.max(1, value || 8) })
              }
            />
            <NumberSetting
              label={t("settingsMessaging.perHour")}
              min={1} integer
              value={settings.ratePerHour ?? 80}
              onChange={(value) =>
                updateSettings({ ratePerHour: Math.max(1, value || 80) })
              }
            />
            <NumberSetting
              label={t("settingsMessaging.minInterval")}
              min={0}
              value={settings.rateMinIntervalSec ?? 4}
              onChange={(value) =>
                updateSettings({ rateMinIntervalSec: Math.max(0, value || 0) })
              }
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <NumberSetting
              label={t("settingsMessaging.jitter")}
              min={0} max={30}
              value={settings.rateJitterSec ?? 2}
              onChange={(value) =>
                updateSettings({
                  rateJitterSec: Math.min(30, Math.max(0, value || 0)),
                })
              }
            />
            <NumberSetting
              label={t("settingsMessaging.globalGap")}
              min={0} max={60}
              value={settings.globalMinGapSec ?? 2}
              onChange={(value) =>
                updateSettings({
                  globalMinGapSec: Math.min(60, Math.max(0, value || 0)),
                })
              }
            />
          </div>
        </fieldset>
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
<SectionLabel>{t("settingsMessaging.conversationBehavior")}</SectionLabel>
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

        <fieldset disabled={settings.autoFollowUpEnabled === false}>
        <ul
          className={
            settings.autoFollowUpEnabled === false
              ? "mt-3 space-y-2 opacity-40"
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
                  <SettingsNumberInput
                    min={1}
                    max={168}
                    value={s.afterHours}
                    disabled={s.enabled === false}
                    onCommit={afterHours => patchRule(rule.id, { afterHours })}
                    className="w-16 text-center text-[12px]"
                  />
                  {t("settingsMessaging.hours")}
                </label>
              </li>
            );
          })}
        </ul>
        </fieldset>
        {settings.autoFollowUpEnabled === false && <p className="mt-2 text-xs text-zinc-500">{t("settingsMessaging.followUpDisabledHint")}</p>}
      </section>




    </div>
  );
}

function NumberSetting({
  label,
  value,
  onChange,
  min, max, integer,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number; max?: number; integer?: boolean;
}) {
  return (
    <label className="block text-2xs text-zinc-500">
      {label}
      <SettingsNumberInput
        min={min} max={max} integer={integer}
        value={value}
        onCommit={onChange}
        className="mt-1"
      />
    </label>
  );
}
