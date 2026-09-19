import { useDeferredValue, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Megaphone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/appStore";
import { useShallow } from "zustand/react/shallow";
import {
  BROADCAST_DEFAULT_EXTRA_GAP_MAX_SEC,
  BROADCAST_DEFAULT_EXTRA_GAP_SEC,
  BROADCAST_HARD_CAP,
} from "@/types/broadcast";
import type { SalesStage } from "@/types/crm";
import {
  contactSendablePhone,
  BROADCAST_DRAFT_ACCOUNT_ID_KEY,
  BROADCAST_DRAFT_CONTACT_IDS_KEY,
  estimateCampaignMinutes,
  parseBroadcastPhones,
  renderBroadcastTemplate,
  validateBroadcastTemplate,
} from "@/lib/broadcastTemplate";
import { campaignProgress } from "@/lib/broadcastCampaign";
import { applyAccountWarmup } from "@/lib/accountWarmup";
import { DEFAULT_RATE_LIMITS } from "@/channels";
import { formatAccountDisplay } from "@/lib/accountLabels";
import { buildContactLookup } from "@/lib/groupMemberDisplay";
import { salesStagesWithLabels } from "@/lib/contactWorkflow";
import { Button, Input, SectionLabel, Textarea } from "@/components/ui/primitives";
import { CampaignRunPanel } from "./CampaignRunPanel";
import { BroadcastPickStep } from "./BroadcastPickStep";
import { BroadcastMediaPicker } from "./BroadcastMediaPicker";
import type {
  BroadcastMedia,
  BroadcastMediaMode,
} from "@/types/broadcast";
import { cacheMediaUrl } from "@/lib/mediaCache";
import { isWaAccountConnected } from "@/lib/accountConnection";
import { useI18n } from "@/i18n";

type Step = "setup" | "run";

export function BroadcastView() {
  const { t } = useI18n();
  const riskDialogRef = useRef<HTMLDialogElement>(null);
  const templateRef = useRef<HTMLTextAreaElement>(null);
  const contacts = useAppStore((s) => s.contacts);
  const campaigns = useAppStore((s) => s.broadcastCampaigns || []);
  const {
    waAccounts,
    liveBaileysAccountId,
    activeAccountId,
    ratePerMinute,
    ratePerHour,
    rateMinIntervalSec,
    sendChannel,
    salesStageLabels,
    salesStageOrder,
  } = useAppStore(
    useShallow((s) => ({
      waAccounts: s.settings.waAccounts,
      liveBaileysAccountId: s.settings.liveBaileysAccountId,
      activeAccountId: s.settings.activeAccountId,
      ratePerMinute: s.settings.ratePerMinute,
      ratePerHour: s.settings.ratePerHour,
      rateMinIntervalSec: s.settings.rateMinIntervalSec,
      sendChannel: s.settings.sendChannel,
      salesStageLabels: s.settings.salesStageLabels,
      salesStageOrder: s.settings.salesStageOrder,
    }))
  );
  const baileysUi = useAppStore((s) => s.baileysUi);
  const createBroadcastCampaign = useAppStore((s) => s.createBroadcastCampaign);
  const startBroadcastCampaign = useAppStore((s) => s.startBroadcastCampaign);
  const pauseBroadcastCampaign = useAppStore((s) => s.pauseBroadcastCampaign);
  const resumeBroadcastCampaign = useAppStore((s) => s.resumeBroadcastCampaign);
  const retryFailedBroadcastCampaign = useAppStore((s) => s.retryFailedBroadcastCampaign);
  const cancelBroadcastCampaign = useAppStore((s) => s.cancelBroadcastCampaign);
  const requestConfirm = useAppStore((s) => s.requestConfirm);
  const pushToast = useAppStore((s) => s.pushToast);

  const accounts = waAccounts || [];
  const [step, setStep] = useState<Step>("setup");
  const [accountId, setAccountId] = useState(
    () => {
      const draftAccountId = sessionStorage.getItem(BROADCAST_DRAFT_ACCOUNT_ID_KEY);
      return (
        accounts.find((item) => item.id === draftAccountId)?.id ||
        liveBaileysAccountId ||
        activeAccountId ||
        accounts[0]?.id ||
        ""
      );
    }
  );
  const [stageFilter, setStageFilter] = useState<SalesStage | "all">("all");
  const [tagFilter, setTagFilter] = useState("");
  const [q, setQ] = useState("");
  const deferredQ = useDeferredValue(q);
  const [selected, setSelected] = useState<Set<string>>(() => {
    try {
      const ids = JSON.parse(
        sessionStorage.getItem(BROADCAST_DRAFT_CONTACT_IDS_KEY) || "[]"
      ) as unknown;
      sessionStorage.removeItem(BROADCAST_DRAFT_CONTACT_IDS_KEY);
      sessionStorage.removeItem(BROADCAST_DRAFT_ACCOUNT_ID_KEY);
      if (!Array.isArray(ids)) return new Set();
      return new Set(
        ids
          .filter((id): id is string => typeof id === "string")
          .filter((id) => {
            const contact = contacts.find((item) => item.id === id);
            return Boolean(
              contact &&
                contactSendablePhone(contact) &&
                (!contact.accountId || !accountId || contact.accountId === accountId)
            );
          })
          .slice(0, BROADCAST_HARD_CAP)
      );
    } catch {
      return new Set();
    }
  });
  const [phoneText, setPhoneText] = useState("");
  const [media, setMedia] = useState<BroadcastMedia[]>([]);
  const [mediaMode, setMediaMode] = useState<BroadcastMediaMode>("single");
  const [mediaDataUrls, setMediaDataUrls] = useState<Record<string, string>>(
    {}
  );
  const [template, setTemplate] = useState(
    "您好 {name}，我是负责对接的同事。方便了解一下贵司{company}最近的采购计划吗？"
  );
  const [extraGapSec, setExtraGapSec] = useState(BROADCAST_DEFAULT_EXTRA_GAP_SEC);
  const [extraGapMaxSec, setExtraGapMaxSec] = useState(
    BROADCAST_DEFAULT_EXTRA_GAP_MAX_SEC
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);

  const insertTemplateVariable = (variable: "{name}" | "{company}") => {
    const input = templateRef.current;
    const start = input?.selectionStart ?? template.length;
    const end = input?.selectionEnd ?? template.length;
    setTemplate(`${template.slice(0, start)}${variable}${template.slice(end)}`);
    window.requestAnimationFrame(() => {
      const cursor = start + variable.length;
      input?.focus();
      input?.setSelectionRange(cursor, cursor);
    });
  };

  const baseLimits = useMemo(
    () => ({
      ...DEFAULT_RATE_LIMITS,
      perPhonePerMinute: ratePerMinute ?? 8,
      perPhonePerHour: ratePerHour ?? 80,
      minIntervalSec: rateMinIntervalSec ?? 4,
    }),
    [ratePerMinute, ratePerHour, rateMinIntervalSec]
  );
  const stages = useMemo(
    () => salesStagesWithLabels(salesStageLabels, salesStageOrder),
    [salesStageLabels, salesStageOrder]
  );

  const account = accounts.find((a) => a.id === accountId);
  const accountConnected = isWaAccountConnected(
    accounts,
    accountId,
    liveBaileysAccountId,
    baileysUi.connection
  );
  const warmup = applyAccountWarmup(
    baseLimits,
    account?.warmupExempt ? undefined : account?.createdAt
  );

  const pool = useMemo(() => {
    const tag = tagFilter.trim().toLowerCase();
    const s = deferredQ.trim().toLowerCase();
    const filtered = contacts.filter((c) => {
      if (c.isGroup) return false;
      if (c.accountId && accountId && c.accountId !== accountId) return false;
      if (stageFilter !== "all" && c.stage !== stageFilter) return false;
      if (tag && !c.tags.some((t) => t.toLowerCase().includes(tag))) return false;
      if (s) {
        const hit =
          c.name.toLowerCase().includes(s) ||
          c.phone.includes(s) ||
          (c.company || "").toLowerCase().includes(s);
        if (!hit) return false;
      }
      return true;
    });
    const lookup = buildContactLookup(filtered, accountId);
    const seen = new Set<string>();
    const unique = [];
    for (const contact of filtered) {
      const phone = contactSendablePhone(contact);
      if (!phone || seen.has(phone)) continue;
      seen.add(phone);
      unique.push(lookup.get(phone.toLowerCase()) || contact);
    }
    return unique;
  }, [contacts, accountId, stageFilter, tagFilter, deferredQ]);

  const selectedList = useMemo(
    () => contacts.filter((c) => selected.has(c.id)),
    [contacts, selected]
  );

  const directPhones = useMemo(
    () => parseBroadcastPhones(phoneText),
    [phoneText]
  );
  const recipientCount = useMemo(() => {
    const phones = new Set(directPhones);
    for (const contact of selectedList) {
      const phone = contactSendablePhone(contact);
      if (phone) phones.add(phone);
    }
    return phones.size;
  }, [directPhones, selectedList]);

  const previewRecipients = useMemo(() => {
    const rows: Array<{
      key: string;
      label: string;
      contact: { name: string; company?: string };
    }> = [];
    const seen = new Set<string>();
    for (const contact of selectedList) {
      const phone = contactSendablePhone(contact);
      if (!phone || seen.has(phone)) continue;
      seen.add(phone);
      rows.push({
        key: contact.id,
        label: contact.name.trim() || phone,
        contact,
      });
    }
    for (const phone of directPhones) {
      if (seen.has(phone)) continue;
      seen.add(phone);
      rows.push({
        key: phone,
        label: phone,
        contact: { name: "", company: "" },
      });
    }
    return rows;
  }, [selectedList, directPhones]);
  const activePreviewIndex = previewRecipients.length
    ? previewIndex % previewRecipients.length
    : 0;
  const previewRecipient = previewRecipients[activePreviewIndex];
  const previewBody = previewRecipient
    ? renderBroadcastTemplate(template, previewRecipient.contact)
    : "";

  const running = campaigns.find((c) => c.status === "running");
  const watching =
    (activeId && campaigns.find((c) => c.id === activeId)) ||
    running ||
    campaigns[0] ||
    null;
  const templateValidation = validateBroadcastTemplate(template);
  const templateError = !templateValidation.ok
    ? templateValidation.reason === "请填写发送内容"
      ? t("broadcast.templateRequired")
      : templateValidation.reason.startsWith("正文过长")
        ? t("broadcast.templateTooLong")
        : (() => {
            const variable = templateValidation.reason.match(/不支持变量\s+([^，，;；]+)/)?.[1];
            return variable
              ? t("broadcast.templateVariable", { variable })
              : templateValidation.reason;
          })()
    : "";
  const launchBlockedReason = !accountId
    ? t("broadcast.selectAccountRequired")
    : !recipientCount
      ? t("broadcast.addRecipientsRequired")
      : recipientCount > BROADCAST_HARD_CAP
        ? t("broadcast.recipientLimit", { count: BROADCAST_HARD_CAP })
        : templateError
          ? templateError
          : warmup.active
            ? t("broadcast.warmupActive")
            : sendChannel === "android_bridge"
              ? t("broadcast.bridgeUnsupported")
              : !accountConnected
                ? t("broadcast.whatsappDisconnected")
                : running
                  ? t("broadcast.broadcastRunning")
                  : "";

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        if (next.size >= BROADCAST_HARD_CAP) {
          pushToast(t("broadcast.maxRecipientsToast", { count: BROADCAST_HARD_CAP }), "info");
          return prev;
        }
        next.add(id);
      }
      return next;
    });
  };

  const selectVisible = (max = BROADCAST_HARD_CAP) => {
    const next = new Set<string>();
    const phones = new Set(directPhones);
    for (const c of pool) {
      const phone = contactSendablePhone(c);
      if (!phone || phones.has(phone)) continue;
      if (phones.size >= max) break;
      phones.add(phone);
      next.add(c.id);
    }
    setSelected(next);
  };

  const validateSetup = () => {
    if (!accountId) {
      pushToast(t("broadcast.selectAccountRequired"), "error");
      return false;
    }
    if (!recipientCount) {
      pushToast(t("broadcast.addRecipientsRequired"), "error");
      return false;
    }
    if (recipientCount > BROADCAST_HARD_CAP) {
      pushToast(t("broadcast.maxRecipientsToast", { count: BROADCAST_HARD_CAP }), "error");
      return false;
    }
    const v = validateBroadcastTemplate(template);
    if (!v.ok) {
      pushToast(templateError || v.reason, "error");
      return false;
    }
    return true;
  };

  const launch = async () => {
    if (!validateSetup()) return;
    if (warmup.active) {
      pushToast(
        t("broadcast.editWhileWarmup", {
          label: t("broadcast.warmupLabel", { hours: warmup.hoursLeft }),
        }),
        "error"
      );
      return;
    }
    if (sendChannel === "android_bridge") {
      if (!useAppStore.getState().bridge.connected) {
        pushToast(t("broadcast.connectBridge"), "error");
        return;
      }
    } else if (!accountConnected) {
      pushToast(t("broadcast.connectWhatsApp"), "error");
      return;
    }
    const mins = estimateCampaignMinutes(
      recipientCount,
      extraGapSec,
      extraGapMaxSec,
      rateMinIntervalSec ?? 4
    );
    const mediaSummary = media.length > 0
      ? t("broadcast.mediaSummary", {
          count: media.length,
          mode: t(
            mediaMode === "random"
              ? "broadcast.mediaModeRandomSummary"
              : mediaMode === "roundrobin"
                ? "broadcast.mediaModeRoundRobinSummary"
                : "broadcast.mediaModeSingleSummary"
          ),
        })
      : t("broadcast.mediaModeText");
    const ok = await requestConfirm({
      title: t("broadcast.confirmStart"),
      description: [
        t("broadcast.confirmAccount", {
          account: formatAccountDisplay({ label: account?.label, userName: account?.userName, index1: 1 }),
        }),
        t("broadcast.confirmRecipients", { count: recipientCount, cap: BROADCAST_HARD_CAP }),
        mediaSummary,
        t("broadcast.confirmGap", { min: extraGapSec, max: extraGapMaxSec }),
        t("broadcast.confirmEstimate", { minutes: mins }),
        t("broadcast.confirmTemplate", {
          text: `${template.trim().slice(0, 80)}${template.trim().length > 80 ? "…" : ""}`,
        }),
        "",
        t("broadcast.confirmRisk"),
      ].join("\n"),
      confirmLabel: t("broadcast.confirmStartLabel"),
      tone: "danger",
    });
    if (!ok) return;

    // 媒体写入 IDB：战役只存元数据，运行器按需回填 data URL
    if (media.length) {
      await Promise.all(
        media.map((m) =>
          mediaDataUrls[m.id]
            ? cacheMediaUrl(m.id, mediaDataUrls[m.id])
            : Promise.resolve()
        )
      );
    }

    const created = createBroadcastCampaign({
      accountId,
      template,
      contactIds: [...selected],
      phoneNumbers: directPhones,
      extraGapSec,
      extraGapMaxSec,
      media,
      mediaMode,
    });
    if (!created.ok) {
      pushToast(created.reason, "error");
      return;
    }
    const started = startBroadcastCampaign(created.id);
    if (!started.ok) {
      pushToast(started.reason, "error");
      setActiveId(created.id);
      setStep("run");
      return;
    }
    setActiveId(created.id);
    setStep("run");
    pushToast(t("broadcast.started"), "success");
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-zinc-950">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-zinc-800/90 px-4 bg-zinc-950/50">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-brand shadow-xs">
            <Megaphone className="h-4 w-4 stroke-[2.2]" />
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-zinc-100">{t("broadcast.title")}</div>
            <div className="truncate text-2xs text-zinc-500">
              {t("broadcast.subtitle", { count: BROADCAST_HARD_CAP })}
            </div>
          </div>
        </div>
        {/* 分步流转指示器 Stepper */}
        <div className="hidden sm:flex items-center gap-2 rounded-full border border-black/10 dark:border-zinc-800 bg-black/5 dark:bg-zinc-900/50 px-3 py-1">
          <span className={cn(
            "flex items-center gap-1.5 text-2xs font-medium",
            step === "setup" ? "text-brand font-semibold" : "text-zinc-500"
          )}>
            <span className={cn(
              "flex h-4 w-4 items-center justify-center rounded-full text-[10px]",
              step === "setup" ? "bg-brand text-brand-foreground" : "bg-black/10 dark:bg-zinc-800"
            )}>1</span>
            {t("broadcast.stepSetup")}
          </span>
          <span className="text-zinc-600">→</span>
          <span className={cn(
            "flex items-center gap-1.5 text-2xs font-medium",
            step === "run" ? "text-brand font-semibold" : "text-zinc-500"
          )}>
            <span className={cn(
              "flex h-4 w-4 items-center justify-center rounded-full text-[10px]",
              step === "run" ? "bg-brand text-brand-foreground" : "bg-black/10 dark:bg-zinc-800"
            )}>2</span>
            {t("broadcast.stepRun")}
          </span>
        </div>
        <Button
          variant="ghost"
          className="!min-h-8 gap-1.5 !px-2.5 text-2xs text-amber-500 hover:text-amber-400 hover:bg-amber-500/10"
          onClick={() => riskDialogRef.current?.showModal()}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          {t("broadcast.riskGuide")}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {step === "setup" && (
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(360px,0.7fr)]">
            <BroadcastPickStep
              phoneText={phoneText}
              onPhoneTextChange={setPhoneText}
              directPhoneCount={directPhones.length}
              recipientCount={recipientCount}
              stages={stages}
              stageFilter={stageFilter}
              onStageFilterChange={setStageFilter}
              tagFilter={tagFilter}
              onTagFilterChange={setTagFilter}
              q={q}
              onQChange={setQ}
              pool={pool}
              selectedContacts={selectedList}
              selected={selected}
              onToggle={toggle}
              onSelectVisible={() => selectVisible()}
              onClear={() => setSelected(new Set())}
            />

            <div className="space-y-4 xl:sticky xl:top-0">
              <section className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-3">
                <SectionLabel>{t("broadcast.account")}</SectionLabel>
                <select
                  value={accountId}
                  onChange={(event) => {
                    setAccountId(event.target.value);
                    setSelected(new Set());
                  }}
                  className="ui-control mt-2 h-9 w-full px-2 text-[13px]"
                >
                  {!accounts.length && <option value="">{t("broadcast.noAccount")}</option>}
                  {accounts.map((item, index) => (
                    <option key={item.id} value={item.id}>
                      {formatAccountDisplay({
                        label: item.label,
                        userName: item.userName,
                        index1: index + 1,
                      })}
                    </option>
                  ))}
                </select>
                {warmup.active && (
                  <p className="mt-2 text-[11px] text-sky-300/90">
                    {t("broadcast.warmupLabel", { hours: warmup.hoursLeft })} — {t("broadcast.warmup")}
                  </p>
                )}
              </section>

              <section className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-3">
                <SectionLabel>{t("broadcast.copy")}</SectionLabel>
                <p className="mt-1 text-2xs text-zinc-600">
                  {t("broadcast.copyHint")}
                </p>
                <div className="mt-2 flex items-center gap-1.5">
                  <Button
                    variant="ghost"
                    className="!min-h-7 !px-2 text-2xs"
                    onClick={() => insertTemplateVariable("{name}")}
                  >
                    {t("broadcast.name")}
                  </Button>
                  <Button
                    variant="ghost"
                    className="!min-h-7 !px-2 text-2xs"
                    onClick={() => insertTemplateVariable("{company}")}
                  >
                    {t("broadcast.company")}
                  </Button>
                </div>
                <Textarea
                  ref={templateRef}
                  value={template}
                  onChange={(event) => setTemplate(event.target.value)}
                  rows={8}
                  className="mt-2"
                />
                <div className="mt-2 border-t border-zinc-800/80 pt-2">
                  <div className="mb-1 text-2xs text-zinc-500">
                    {t("broadcast.mediaHint")}
                  </div>
                  <BroadcastMediaPicker
                    media={media}
                    mediaMode={mediaMode}
                    onChange={(nextMedia, nextMode, dataUrls) => {
                      setMedia(nextMedia);
                      setMediaMode(nextMode);
                      setMediaDataUrls(dataUrls);
                    }}
                  />
                </div>
                <div className="mt-3 flex items-end gap-2 text-2xs text-zinc-500">
                  <label>
                    {t("broadcast.minGap")}
                    <Input
                      type="number"
                      min={5}
                      max={120}
                      value={extraGapSec}
                      onChange={(event) => {
                        const value = Math.min(120, Math.max(5, Number(event.target.value) || 20));
                        setExtraGapSec(value);
                        setExtraGapMaxSec((current) => Math.max(current, value));
                      }}
                      className="mt-1 h-8 w-28"
                    />
                  </label>
                  <span className="pb-2 text-zinc-600">{t("broadcast.to")}</span>
                  <label>
                    {t("broadcast.maxGap")}
                    <Input
                      type="number"
                      min={extraGapSec}
                      max={120}
                      value={extraGapMaxSec}
                      onChange={(event) =>
                        setExtraGapMaxSec(
                          Math.min(120, Math.max(extraGapSec, Number(event.target.value) || 30))
                        )
                      }
                      className="mt-1 h-8 w-28"
                    />
                  </label>
                </div>
              </section>

              <section className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-3">
                <div className="flex items-center justify-between gap-2">
                  <SectionLabel>{t("broadcast.preview")}</SectionLabel>
                  {previewRecipient ? (
                    <div className="flex min-w-0 items-center gap-1 text-2xs text-zinc-500">
                      <button
                        type="button"
                        aria-label={t("broadcast.previousPreviewRecipient")}
                        disabled={previewRecipients.length < 2}
                        className="rounded p-1 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"
                        onClick={() =>
                          setPreviewIndex(
                            (activePreviewIndex - 1 + previewRecipients.length) % previewRecipients.length
                          )
                        }
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </button>
                      <span className="max-w-40 truncate" title={previewRecipient.label}>
                        {previewRecipient.label} · {activePreviewIndex + 1}/{previewRecipients.length}
                      </span>
                      <button
                        type="button"
                        aria-label={t("broadcast.nextPreviewRecipient")}
                        disabled={previewRecipients.length < 2}
                        className="rounded p-1 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"
                        onClick={() =>
                          setPreviewIndex((activePreviewIndex + 1) % previewRecipients.length)
                        }
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : null}
                </div>
                {previewRecipient ? (
                  <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-[12px] leading-5 text-zinc-300">
                    {previewBody}
                  </p>
                ) : (
                  <p className="mt-2 text-[12px] text-zinc-600">
                    {t("broadcast.previewEmpty")}
                  </p>
                )}
              </section>

              <section className="sticky bottom-0 rounded-xl border border-brand/30 bg-zinc-900/95 p-3 shadow-xl shadow-black/30 backdrop-blur">
                <div className="grid grid-cols-2 gap-2 text-2xs text-zinc-500">
                  <div>
                    <div>{t("broadcast.recipients")}</div>
                    <div className="mt-1 tabular-nums text-brand">
                      {recipientCount}/{BROADCAST_HARD_CAP}
                    </div>
                  </div>
                  <div>
                    <div>{t("broadcast.estimated")}</div>
                    <div className="mt-1 tabular-nums text-zinc-200">
                      ≥ {estimateCampaignMinutes(
                        recipientCount,
                        extraGapSec,
                        extraGapMaxSec,
                        rateMinIntervalSec ?? 4
                      )} {t("broadcast.minutes")}
                    </div>
                  </div>
                </div>
                {warmup.active && (
                  <p className="mt-3 text-2xs text-sky-300">
                    {t("broadcast.warmupBlocked", {
                      label: t("broadcast.warmupLabel", { hours: warmup.hoursLeft }),
                    })}
                  </p>
                )}
                {recipientCount > BROADCAST_HARD_CAP && (
                  <p className="mt-3 text-2xs text-rose-300">
                    {t("broadcast.overLimit", { count: recipientCount - BROADCAST_HARD_CAP })}
                  </p>
                )}
                <p className="mt-3 flex items-center gap-1.5 text-2xs text-amber-300/80">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {t("broadcast.riskWarning")}
                </p>
                <Button
                  variant="primary"
                  className="mt-3 w-full !min-h-10"
                  disabled={Boolean(launchBlockedReason)}
                  onClick={() => void launch()}
                >
                  {launchBlockedReason || t("broadcast.start")}
                </Button>
              </section>
            </div>
          </div>
        )}

        {step === "run" && watching && (
          <CampaignRunPanel
            campaignId={watching.id}
            onBack={() => {
              setStep("setup");
              setActiveId(null);
            }}
            onPause={() => pauseBroadcastCampaign(watching.id)}
            onResume={() => {
              const r = resumeBroadcastCampaign(watching.id);
              if (!r.ok) pushToast(r.reason, "error");
            }}
            onRetryFailed={async () => {
              const failed = watching.items.filter((item) => item.status === "failed").length;
              if (!failed) return;
              const ok = await requestConfirm({
                  title: t("broadcast.retryFailedTitle", { count: failed }),
                  description: t("broadcast.retryFailedDescription"),
                  confirmLabel: t("broadcast.retryFailedConfirm"),
                tone: "danger",
              });
              if (!ok) return;
              retryFailedBroadcastCampaign(watching.id);
              const result = resumeBroadcastCampaign(watching.id);
              if (!result.ok) pushToast(result.reason, "error");
            }}
            onCancel={async () => {
              const ok = await requestConfirm({
                title: t("broadcast.cancelTitle"),
                description: t("broadcast.cancelDescription"),
                confirmLabel: t("broadcast.cancelConfirm"),
                tone: "danger",
              });
              if (ok) cancelBroadcastCampaign(watching.id);
            }}
          />
        )}

        {step !== "run" && campaigns.length > 0 && (
          <section className="mt-8">
            <SectionLabel>{t("broadcast.recent")}</SectionLabel>
            <ul className="mt-2 space-y-1.5">
              {campaigns.slice(0, 8).map((c) => {
                const p = campaignProgress(c);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-left text-[12px] hover:border-zinc-700"
                      onClick={() => {
                        setActiveId(c.id);
                        setStep("run");
                      }}
                    >
                      <span className="truncate text-zinc-200">
                        {c.title || c.template.slice(0, 28)}
                        <span className="ml-2 text-2xs text-zinc-500">
                          {c.status}
                        </span>
                      </span>
                      <span className="tabular-nums text-2xs text-zinc-500">
                        {p.sent}/{p.total}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>

      <dialog
        ref={riskDialogRef}
        aria-labelledby="broadcast-risk-title"
        className="m-auto w-full max-w-md rounded-xl border border-amber-500/30 bg-zinc-900 p-0 text-zinc-100 shadow-2xl backdrop:bg-black/70"
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        <div className="border-b border-zinc-800 px-4 py-3">
          <h2
            id="broadcast-risk-title"
            className="flex items-center gap-2 text-[14px] font-semibold text-amber-200"
          >
            <AlertTriangle className="h-4 w-4" />
            {t("broadcast.riskTitle")}
          </h2>
        </div>
        <ul className="list-disc space-y-2 px-8 py-4 text-[12px] leading-relaxed text-zinc-300">
          <li>{t("broadcast.riskItemOne")}</li>
          <li>{t("broadcast.riskItemTwo")}</li>
          <li>{t("broadcast.riskItemThree")}</li>
          <li>{t("broadcast.riskItemFour")}</li>
        </ul>
        <form method="dialog" className="flex justify-end border-t border-zinc-800 px-4 py-3">
          <Button type="submit" variant="primary" className="!min-h-8 !px-4 text-2xs">
            {t("broadcast.known")}
          </Button>
        </form>
      </dialog>
    </div>
  );
}
