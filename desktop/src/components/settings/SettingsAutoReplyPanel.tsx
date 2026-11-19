import { useState } from "react";
import { useAppStore } from "@/store/appStore";
import {
  resolveAutoReplyPolicy,
  type AiAutoReplyPolicy,
} from "@/lib/aiSafety";
import { formatAccountDisplay } from "@/lib/accountLabels";
import { Button, Input, SectionLabel, Switch, Textarea } from "@/components/ui/primitives";
import { ArrowRight, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { AiPromptLibrary } from "./AiPromptLibrary";
import { SettingsNumberInput } from "./SettingsNumberInput";
import { MAX_EFFECTIVE_PROMPT_CHARS } from "@/lib/aiPromptScope";

/**
 * AI 自动回复设置：回复模式、自动回复行为、聊天身份与偏好。
 * 与「AI 设置」里的模型服务分开，便于后续扩展
 * 账号级开关 / 生效时段 / 触发条件等自动回复专项配置。
 */
export function SettingsAutoReplyPanel() {
  const { t } = useI18n();
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const [profileAccountId, setProfileAccountId] = useState("");
  const followUpDelays = settings.aiAutoFollowUpDelaysMinutes || [];
  const followUpConfigured = followUpDelays.length > 0 && followUpDelays.every(value => Number.isFinite(value) && value > 0);

  const accountPrompt = profileAccountId
    ? settings.aiSystemPromptByAccountId[profileAccountId] || ""
    : settings.aiSystemPrompt || "";
  const selectedAccountIndex = settings.waAccounts.findIndex(
    (account) => account.id === profileAccountId
  );
  const selectedAccount = settings.waAccounts[selectedAccountIndex];
  const profileLabel = selectedAccount
    ? formatAccountDisplay({
        label: selectedAccount.label,
        userName: selectedAccount.userName,
        phoneE164: selectedAccount.phoneE164,
        index1: selectedAccountIndex + 1,
      })
    : t("settingsAutoReply.defaultIdentity");
  const effectivePolicy = resolveAutoReplyPolicy(
    settings.aiAutoReplyPolicy,
    settings.aiAutoReplyPolicyByAccountId,
    profileAccountId || undefined
  );
  const hasPolicyOverride = !!(
    profileAccountId && settings.aiAutoReplyPolicyByAccountId[profileAccountId]
  );

  const updateAccountPrompt = (value: string) => {
    if (!profileAccountId) {
      updateSettings({ aiSystemPrompt: value });
      return;
    }
    const next = { ...settings.aiSystemPromptByAccountId };
    if (value) next[profileAccountId] = value;
    else delete next[profileAccountId];
    updateSettings({ aiSystemPromptByAccountId: next });
  };

  const updateFollowUpDelays = (delays: number[]) => updateSettings({
    aiAutoFollowUpDelaysMinutes: delays,
    ...(settings.aiAutoFollowUpEnabled && (!delays.length || delays.some(value => value <= 0))
      ? { aiAutoFollowUpEnabled: false }
      : {}),
  });

  const updateAccountPolicy = (patch: Partial<AiAutoReplyPolicy>) => {
    const nextPolicy = { ...effectivePolicy, ...patch };
    if (!profileAccountId) {
      updateSettings({ aiAutoReplyPolicy: nextPolicy });
      return;
    }
    updateSettings({
      aiAutoReplyPolicyByAccountId: {
        ...settings.aiAutoReplyPolicyByAccountId,
        [profileAccountId]: nextPolicy,
      },
    });
  };

  const resetAccountPolicy = () => {
    if (!profileAccountId) return;
    const next = { ...settings.aiAutoReplyPolicyByAccountId };
    delete next[profileAccountId];
    updateSettings({ aiAutoReplyPolicyByAccountId: next });
  };

  const enableDefaultAutoReply = async () => {
    if (settings.aiReplyMode === "auto") return;
    if (!await useAppStore.getState().requestConfirm({
      title: t("settingsAutoReply.autoConfirmTitle"),
      description: t("settingsAutoReply.autoConfirmDescription"),
      confirmLabel: t("settingsAutoReply.autoConfirmButton"),
      cancelLabel: t("common.cancel"),
      tone: "danger",
    })) return;
    updateSettings({ aiReplyMode: "auto" });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h3 className="text-lg font-semibold text-zinc-100">{t("settingsAutoReply.title")}</h3>
        <p className="mt-1 text-[11px] text-zinc-500">
          {t("settingsAutoReply.description")}
        </p>
      </header>

      <div className="space-y-3">
        <AiPromptLibrary />
        <Button
          className="flex w-full items-center justify-between gap-3 p-3 text-left"
          onClick={() => { useAppStore.getState().setActiveNav("ai-outreach"); useAppStore.getState().setSettingsOpen(false); }}
        >
          <span className="flex min-w-0 items-center gap-3">
            <ClipboardList className="h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{t("aiOutreach.tasks")}</span>
              <span className="mt-0.5 block text-xs text-zinc-500">{t("settingsAutoReply.taskEntryHint")}</span>
            </span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden="true" />
        </Button>
      </div>
      <label className="block border-t border-zinc-800 pt-4 text-xs">{t("aiLibrary.context")}
        <select value={settings.aiContextMode||"full"} onChange={event=>updateSettings({aiContextMode:event.target.value as "compact"|"full"})} className="ui-control mt-2 w-full px-2 py-2">
          <option value="full">{t("aiLibrary.full")}</option><option value="compact">{t("aiLibrary.compact")}</option>
        </select>
      </label>
      <section className="border-t border-zinc-800 pt-4">
        <SectionLabel>{t("autoReplyScope.defaultMode")}</SectionLabel>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => updateSettings({ aiReplyMode: "semi" })}
            className={cn(
              "flex flex-col items-start gap-1 rounded-lg border px-3 py-3 text-left transition-colors",
              settings.aiReplyMode === "semi"
                ? "border-brand/60 bg-zinc-900"
                : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
            )}
          >
            <span className="text-[13px] font-medium text-zinc-100">{t("settingsAutoReply.semi")}</span>
            <span className="text-2xs leading-4 text-zinc-500">
              {t("autoReplyScope.defaultManualHint")}
            </span>
          </button>
          <button
            type="button"
            onClick={() => void enableDefaultAutoReply()}
            className={cn(
              "flex flex-col items-start gap-1 rounded-lg border px-3 py-3 text-left transition-colors",
              settings.aiReplyMode === "auto"
                ? "border-brand/60 bg-zinc-900"
                : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
            )}
          >
            <span className="text-[13px] font-medium text-zinc-100">{t("settingsAutoReply.auto")}</span>
            <span className="text-2xs leading-4 text-zinc-500">
              {t("autoReplyScope.defaultAutoHint")}
            </span>
          </button>
        </div>
        <p className="mt-3 text-xs text-zinc-500">{t("autoReplyScope.defaultHint")}</p>
      </section>

      <section className="border-t border-zinc-800 pt-4">
          <SectionLabel>{t("settingsAutoReply.behavior")}</SectionLabel>
          <label className="mt-3 block text-2xs text-zinc-500">
            {t("settingsAutoReply.minInterval")}
            <SettingsNumberInput
              min={5}
              integer
              value={Math.round((settings.aiAutoReplyIntervalMs || 30000) / 1000)}
              onCommit={value => updateSettings({ aiAutoReplyIntervalMs: value * 1000 })}
              className="mt-1"
            />
          </label>
          <p className="mt-3 text-xs">{t("settingsAutoReply.delayRange")}</p>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <label className="text-2xs">{t("settingsAutoReply.delayMin")}<SettingsNumberInput min={0} max={300} integer value={settings.aiAutoReplyDelayMinMs / 1000} onCommit={value => {
              const min = value * 1000;
              updateSettings({ aiAutoReplyDelayMinMs: min, aiAutoReplyDelayMaxMs: Math.max(min, settings.aiAutoReplyDelayMaxMs) });
            }} /></label>
            <label className="text-2xs">{t("settingsAutoReply.delayMax")}<SettingsNumberInput min={settings.aiAutoReplyDelayMinMs / 1000} max={300} integer value={settings.aiAutoReplyDelayMaxMs / 1000} onCommit={value => updateSettings({ aiAutoReplyDelayMaxMs: value * 1000 })} /></label>
          </div>
          <p className="mt-2 text-2xs text-zinc-500">{t("settingsAutoReply.delayHint")}</p>
          <details className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-2xs leading-4 text-amber-100">
            <summary className="cursor-pointer font-medium">{t("settingsAutoReply.warningTitle")}</summary>
            <p className="mt-2">{t("settingsAutoReply.warning")}</p>
          </details>
      </section>

      <section className="border-t border-zinc-800 pt-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <SectionLabel>{t("settingsAutoReply.followUpTitle")}</SectionLabel>
            <p className="mt-1 text-2xs text-zinc-500">{t("settingsAutoReply.followUpHint")}</p>
          </div>
          <label className="inline-flex cursor-pointer">
            <Switch
              checked={settings.aiAutoFollowUpEnabled}
              aria-label={t("settingsAutoReply.followUpTitle")}
              disabled={!settings.aiAutoFollowUpEnabled && !followUpConfigured}
              onChange={event => updateSettings(event.target.checked
                ? { aiAutoFollowUpEnabled: true, aiAutoFollowUpEnabledAt: Date.now() }
                : { aiAutoFollowUpEnabled: false })}
            />
          </label>
        </div>
        <div className="mt-3 divide-y divide-zinc-800/70">
          {followUpDelays.map((minutes, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2 py-2 text-xs">
              <span className="mr-auto text-zinc-300">{t("settingsAutoReply.followUpStep", { step: index + 1 })}</span>
              <span className="text-zinc-500">{t("settingsAutoReply.followUpWait")}</span>
              <Input
                type="number"
                min={1}
                max={43_200}
                value={minutes || ""}
                aria-label={t("settingsAutoReply.followUpMinutes", { step: index + 1 })}
                onChange={event => {
                  const value = event.target.value === "" ? 0 : Math.max(0, Math.min(43_200, Math.round(Number(event.target.value) || 0)));
                  const next = [...followUpDelays];
                  next[index] = value;
                  updateFollowUpDelays(next);
                }}
                className="w-28"
              />
              <span className="text-zinc-500">{t("settingsAutoReply.minutes")}</span>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                aria-label={t("settingsAutoReply.removeFollowUpStep", { step: index + 1 })}
                onClick={() => updateFollowUpDelays(followUpDelays.filter((_, itemIndex) => itemIndex !== index))}
              >
                {t("common.delete")}
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              size="xs"
              variant="secondary"
              disabled={followUpDelays.length >= 10}
              onClick={() => updateFollowUpDelays([...followUpDelays, 0])}
            >
              {t("settingsAutoReply.addFollowUpStep")}
            </Button>
            {!followUpConfigured && <span className="text-2xs text-amber-500">{t("settingsAutoReply.followUpNeedsInterval")}</span>}
          </div>
        </div>
      </section>

      <section className="border-t border-zinc-800 pt-4">
        <SectionLabel
          action={
            <select
              value={profileAccountId}
              onChange={(event) => {
                setProfileAccountId(event.target.value);
              }}
              className="ui-control h-8 max-w-52 px-2 text-[11px]"
              aria-label={t("settingsAutoReply.selectAccount")}
            >
              <option value="">{t("settingsAutoReply.defaultIdentity")}</option>
              {settings.waAccounts.map((account, index) => (
                <option key={account.id} value={account.id}>
                  {formatAccountDisplay({
                    label: account.label,
                    userName: account.userName,
                    phoneE164: account.phoneE164,
                    index1: index + 1,
                  })}
                </option>
              ))}
            </select>
          }
        >
          {t("settingsAutoReply.identity")}
        </SectionLabel>
        <p className="mt-1 text-2xs leading-4 text-zinc-600">
          {profileAccountId
            ? t("settingsAutoReply.accountIdentityHint", { account: profileLabel })
            : t("settingsAutoReply.defaultIdentityHint")}
        </p>
        <Textarea
          value={accountPrompt}
          onChange={(event) => updateAccountPrompt(event.target.value)}
          aria-invalid={accountPrompt.trim().length > MAX_EFFECTIVE_PROMPT_CHARS}
          className="mt-2 min-h-24 w-full"
          placeholder={
            profileAccountId && settings.aiSystemPrompt
              ? t("settingsAutoReply.inheritPlaceholder", { prompt: settings.aiSystemPrompt })
              : t("settingsAutoReply.identityPlaceholder")
          }
        />
        <p role={accountPrompt.trim().length > MAX_EFFECTIVE_PROMPT_CHARS ? "alert" : undefined} className="mt-2 text-xs text-zinc-500">
          {t("settingsAutoReply.promptLength", { count: accountPrompt.trim().length, max: MAX_EFFECTIVE_PROMPT_CHARS })}
        </p>
      </section>

      <section className="border-t border-zinc-800 pt-4">
        <SectionLabel
          action={
            hasPolicyOverride ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={resetAccountPolicy}
              >
                {t("settingsAutoReply.restoreInheritance")}
              </Button>
            ) : undefined
          }
        >
          {t("settingsAutoReply.policy")}
        </SectionLabel>
        <p className="mt-1 text-2xs leading-4 text-zinc-600">
          {profileAccountId
            ? t(hasPolicyOverride ? "settingsAutoReply.policyOverride" : "settingsAutoReply.policyInherited", { account: profileLabel })
            : t("settingsAutoReply.defaultPolicyHint")}
          {" "}{t("settingsAutoReply.hoursHint")}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-2xs text-zinc-500">
            {t("settingsAutoReply.startTime")}
            <Input
              type="time"
              value={effectivePolicy.activeStart}
              onChange={(event) =>
                updateAccountPolicy({ activeStart: event.target.value })
              }
              className="mt-1"
            />
          </label>
          <label className="text-2xs text-zinc-500">
            {t("settingsAutoReply.endTime")}
            <Input
              type="time"
              value={effectivePolicy.activeEnd}
              onChange={(event) =>
                updateAccountPolicy({ activeEnd: event.target.value })
              }
              className="mt-1"
            />
          </label>
        </div>
        <label className="mt-3 block text-2xs text-zinc-500">
          {t("settingsAutoReply.takeoverMinutes")}
          <Input
            type="number"
            min={1}
            max={1440}
            value={effectivePolicy.takeoverMinutes}
            onChange={(event) =>
              updateAccountPolicy({
                takeoverMinutes: Math.min(
                  1440,
                  Math.max(1, Number(event.target.value) || 1)
                ),
              })
            }
            className="mt-1"
          />
        </label>
      </section>

    </div>
  );
}
