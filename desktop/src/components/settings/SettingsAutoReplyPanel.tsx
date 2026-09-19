import { useState } from "react";
import { useAppStore } from "@/store/appStore";
import { generateSuggestions, hasRealAiKey } from "@/lib/aiSuggest";
import {
  evaluateAutoReplyDecision,
  getAutoReplyOutputBlockReason,
  parseAutoReplyReplay,
  resolveAutoReplyPolicy,
  type AiAutoReplyPolicy,
} from "@/lib/aiSafety";
import { formatAccountDisplay } from "@/lib/accountLabels";
import { Button, Input, SectionLabel, Textarea } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { useI18n, type TranslationKey } from "@/i18n";

function localizeSafetyReason(reason: string, t: (key: TranslationKey, params?: Record<string, string | number>) => string) {
  if (reason.includes("生效时段")) return t("settingsAutoReply.reason.outsideHours");
  if (reason.includes("手动回复")) return t("settingsAutoReply.reason.manualTakeover");
  if (reason.includes("敏感信息")) return t("settingsAutoReply.reason.sensitive");
  if (reason.includes("付款、合同")) return t("settingsAutoReply.reason.financial");
  if (reason.includes("价格")) return t("settingsAutoReply.reason.pricing");
  if (reason.includes("投诉")) return t("settingsAutoReply.reason.complaint");
  if (reason.includes("消息为空")) return t("settingsAutoReply.reason.empty");
  if (reason.includes("未经确认")) return t("settingsAutoReply.reason.promise");
  if (reason.includes("低风险")) return t("settingsAutoReply.reason.safe");
  return reason;
}

/**
 * AI 自动回复设置：回复模式、自动回复行为、聊天身份与偏好。
 * 与「AI 设置」里的模型服务分开，便于后续扩展
 * 账号级开关 / 生效时段 / 触发条件等自动回复专项配置。
 */
export function SettingsAutoReplyPanel() {
  const { t } = useI18n();
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const [testMessage, setTestMessage] = useState(
    t("settingsAutoReply.testDefault")
  );
  const [testReplies, setTestReplies] = useState<string[]>([]);
  const [testError, setTestError] = useState("");
  const [testing, setTesting] = useState(false);
  const [profileAccountId, setProfileAccountId] = useState("");

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

  const replayMessages = parseAutoReplyReplay(testMessage);
  const lastReplayInbound = [...replayMessages]
    .reverse()
    .find((message) => message.direction === "in");
  const replayDecision = lastReplayInbound
    ? evaluateAutoReplyDecision(
        replayMessages,
        lastReplayInbound,
        Date.now(),
        effectivePolicy
      )
    : null;

  const testReply = async () => {
    if (!lastReplayInbound || !replayDecision) return;
    setTesting(true);
    setTestError("");
    try {
      const result = await generateSuggestions(undefined, replayMessages, settings, {
        auto: replayDecision.allow,
        accountId: profileAccountId || undefined,
      });
      const replies = result.suggestions
        .slice(0, replayDecision.allow ? 1 : 3)
        .map((suggestion) => suggestion.text);
      const outputBlock = replayDecision.allow
        ? getAutoReplyOutputBlockReason(replies[0] || "", {
            allowPricing: effectivePolicy.allowPricing,
          })
        : null;
      if (outputBlock) {
        setTestError(t("settingsAutoReply.outputBlocked", { reason: localizeSafetyReason(outputBlock, t) }));
      }
      setTestReplies(replies);
    } catch (error) {
      setTestReplies([]);
      setTestError(error instanceof Error ? error.message : t("settingsAutoReply.testFailed"));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h3 className="text-lg font-semibold text-zinc-100">{t("settingsAutoReply.title")}</h3>
        <p className="mt-1 text-[11px] text-zinc-500">
          {t("settingsAutoReply.description")}
        </p>
      </header>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
        <SectionLabel>{t("settingsAutoReply.mode")}</SectionLabel>
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
              {t("settingsAutoReply.semiHint")}
            </span>
          </button>
          <button
            type="button"
            onClick={() => updateSettings({ aiReplyMode: "auto" })}
            className={cn(
              "flex flex-col items-start gap-1 rounded-lg border px-3 py-3 text-left transition-colors",
              settings.aiReplyMode === "auto"
                ? "border-brand/60 bg-zinc-900"
                : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
            )}
          >
            <span className="text-[13px] font-medium text-zinc-100">{t("settingsAutoReply.auto")}</span>
            <span className="text-2xs leading-4 text-zinc-500">
              {t("settingsAutoReply.autoHint")}
            </span>
          </button>
        </div>
      </section>

      {settings.aiReplyMode === "auto" && (
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
          <SectionLabel>{t("settingsAutoReply.behavior")}</SectionLabel>
          <label className="mt-3 block text-2xs text-zinc-500">
            {t("settingsAutoReply.minInterval")}
            <Input
              type="number"
              min={5}
              value={Math.round((settings.aiAutoReplyIntervalMs || 30000) / 1000)}
              onChange={(event) => {
                const v = Math.max(5, Number(event.target.value) || 30);
                updateSettings({ aiAutoReplyIntervalMs: v * 1000 });
              }}
              className="mt-1"
            />
          </label>
          <p className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-2xs leading-4 text-amber-100">
            {t("settingsAutoReply.warning")}
          </p>
        </section>
      )}

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
        <SectionLabel
          action={
            <select
              value={profileAccountId}
              onChange={(event) => {
                setProfileAccountId(event.target.value);
                setTestReplies([]);
                setTestError("");
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
          maxLength={6000}
          className="mt-2 min-h-24 w-full"
          placeholder={
            profileAccountId && settings.aiSystemPrompt
              ? t("settingsAutoReply.inheritPlaceholder", { prompt: settings.aiSystemPrompt })
              : t("settingsAutoReply.identityPlaceholder")
          }
        />
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
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
                  Math.max(1, Number(event.target.value) || 30)
                ),
              })
            }
            className="mt-1"
          />
        </label>
        <label className="mt-3 flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
          <input
            type="checkbox"
            checked={effectivePolicy.allowPricing}
            onChange={(event) =>
              updateAccountPolicy({ allowPricing: event.target.checked })
            }
            className="mt-0.5 accent-emerald-500"
          />
          <span className="text-2xs leading-4 text-zinc-400">
            {t("settingsAutoReply.allowPricing")}
            <span className="block text-zinc-600">
              {t("settingsAutoReply.allowPricingHint")}
            </span>
          </span>
        </label>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
        <SectionLabel>{t("settingsAutoReply.replay")}</SectionLabel>
        <p className="mt-1 text-2xs leading-4 text-zinc-600">
          {t("settingsAutoReply.replayHint", { identity: profileLabel })}
          {!hasRealAiKey(settings) && ` ${t("settingsAutoReply.demoNotice")}`}
        </p>
        <Textarea
          value={testMessage}
          onChange={(event) => {
            setTestMessage(event.target.value);
            setTestReplies([]);
            setTestError("");
          }}
          className="mt-2 min-h-32 w-full"
          placeholder={
            t("settingsAutoReply.replayPlaceholder")
          }
        />
        {replayDecision ? (
          <p
            className={cn(
              "mt-2 rounded-lg border px-3 py-2 text-2xs leading-4",
              replayDecision.allow
                ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"
                : "border-amber-500/25 bg-amber-500/10 text-amber-200"
            )}
          >
            {replayDecision.allow ? t("settingsAutoReply.allowed") : t("settingsAutoReply.manual")}: {localizeSafetyReason(replayDecision.reason, t)}
          </p>
        ) : (
          <p className="mt-2 text-2xs text-amber-300">
            {t("settingsAutoReply.needInbound")}
          </p>
        )}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-2"
          disabled={testing || !lastReplayInbound}
          onClick={() => void testReply()}
        >
          {testing ? t("settingsAutoReply.generating") : t("settingsAutoReply.runReplay")}
        </Button>
        {testError && <p className="mt-2 text-2xs text-red-300">{testError}</p>}
        {testReplies.length > 0 && (
          <div className="mt-3 space-y-2">
            <p className="text-[10px] text-zinc-500">
              {replayDecision?.allow && !testError
                ? t("settingsAutoReply.proposedAutoReply")
                : t("settingsAutoReply.manualSuggestion")}
            </p>
            {testReplies.map((reply, index) => (
              <div
                key={`${index}-${reply}`}
                className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-[12px] leading-5 text-zinc-200"
              >
                {reply}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
