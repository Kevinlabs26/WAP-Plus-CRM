import { useDeferredValue, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Info,
  Megaphone,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { flushPersist, useAppStore } from "@/store/appStore";
import { useShallow } from "zustand/react/shallow";
import {
  BROADCAST_DEFAULT_EXTRA_GAP_MAX_SEC,
  BROADCAST_DEFAULT_EXTRA_GAP_SEC,
  BROADCAST_HARD_CAP,
  BROADCAST_MAX_THEMES,
  BROADCAST_MAX_VARIANTS,
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
import { SettingsNumberInput } from "@/components/settings/SettingsNumberInput";
import { CampaignRunPanel } from "./CampaignRunPanel";
import { BroadcastPickStep, type BroadcastRecipientSource } from "./BroadcastPickStep";
import { BroadcastMediaPicker } from "./BroadcastMediaPicker";
import type {
  BroadcastMedia,
  BroadcastMediaMode,
  BroadcastTheme,
  BroadcastVariant,
} from "@/types/broadcast";
import { cacheMediaUrl, readMediaCache } from "@/lib/mediaCache";
import { isWaAccountConnected } from "@/lib/accountConnection";
import { routeBroadcastAccounts } from "@/lib/broadcastAccountRouting";
import { useI18n } from "@/i18n";

type Step = "setup" | "run";

type VariantDraft = BroadcastVariant & { media: BroadcastMedia[]; mediaMode: BroadcastMediaMode; dataUrls: Record<string, string> };
function newVariant(template = ""): VariantDraft {
  return { id: `bv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, template, media: [], mediaMode: "single", dataUrls: {} };
}

export function BroadcastView() {
  const { t } = useI18n();
  const riskDialogRef = useRef<HTMLDialogElement>(null);
  const templateRef = useRef<HTMLTextAreaElement>(null);
  const contacts = useAppStore((s) => s.contacts);
  const chats = useAppStore((s) => s.chats);
  const messages = useAppStore((s) => s.messages);
  const campaigns = useAppStore((s) => s.broadcastCampaigns || []);
  const broadcastThemes = useAppStore((s) => s.settings.broadcastThemes || []);
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
  const bridge = useAppStore((s) => s.bridge);
  const android = sendChannel === "android_bridge";
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
        accounts.find((item) => item.id === liveBaileysAccountId)?.id ||
        accounts.find((item) => item.id === activeAccountId)?.id ||
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
                contactSendablePhone(contact)
            );
          })
          .slice(0, BROADCAST_HARD_CAP)
      );
    } catch {
      return new Set();
    }
  });
  const [phoneText, setPhoneText] = useState("");
  const [recipientSource, setRecipientSource] = useState<BroadcastRecipientSource>(() => selected.size ? "contacts" : "numbers");
  const [mediaBusy, setMediaBusy] = useState(false);
  const [themeBusy, setThemeBusy] = useState(false);
  const [themeError, setThemeError] = useState("");
  const [versions, setVersions] = useState<VariantDraft[]>(() => [newVariant("您好 {name}，我是负责对接的同事。方便了解一下贵司最近的采购计划吗？")]);
  const [randomVersions, setRandomVersions] = useState(false);
  const [versionId, setVersionId] = useState("");
  const [selectedThemeId, setSelectedThemeId] = useState("");
  const [themeName, setThemeName] = useState("");
  const [themeEditorOpen, setThemeEditorOpen] = useState(false);
  const currentVersion = (randomVersions && versions.find(v => v.id === versionId)) || versions[0];
  const { template, media, mediaMode, dataUrls: mediaDataUrls } = currentVersion;
  const activeVersions = randomVersions ? versions : [versions[0]];
  const updateVersion = (patch: Partial<VariantDraft>) => setVersions(all => all.map(v => v.id === currentVersion.id ? { ...v, ...patch } : v));
  const setTemplate = (value: string) => updateVersion({ template: value });
  const currentVersionNumber = versions.indexOf(currentVersion) + 1;
  const loadTheme = async (id: string) => {
    setThemeError("");
    if (!id) {
      setSelectedThemeId(""); setThemeName(""); setThemeEditorOpen(false);
      return;
    }
    const theme = useAppStore.getState().settings.broadcastThemes.find(item => item.id === id);
    if (!theme) return;
    setThemeBusy(true);
    try {
      const loaded = await Promise.all(theme.variants.map(async variant => {
        const saved = await Promise.all((variant.media || []).map(async item => [item, await readMediaCache(item.id)] as const));
        const available = saved.filter((entry): entry is [BroadcastMedia, string] => Boolean(entry[1]));
        return { ...variant, media: available.map(([item]) => item), mediaMode: variant.mediaMode || "single",
          dataUrls: Object.fromEntries(available.map(([item, url]) => [item.id, url])) };
      }));
      setVersions(loaded);
      setVersionId(loaded[0]?.id || "");
      setSelectedThemeId(theme.id);
      setThemeName(theme.name);
      setThemeEditorOpen(false);
      setRandomVersions(true);
      if (loaded.some((variant, index) => variant.media.length !== (theme.variants[index]?.media || []).length)) setThemeError(t("broadcast.themeMediaMissing"));
    } catch (error) {
      setThemeError(error instanceof Error ? error.message : String(error));
    } finally {
      setThemeBusy(false);
    }
  };
  const startNewTheme = () => {
    setSelectedThemeId(""); setThemeName(""); setThemeEditorOpen(true); setThemeError(""); setRandomVersions(true);
  };
  const cancelThemeEdit = () => {
    if (selectedThemeId) { void loadTheme(selectedThemeId); return; }
    setThemeName(""); setThemeEditorOpen(false); setThemeError("");
  };
  const saveTheme = async () => {
    const name = themeName.trim();
    if (!name || versions.length < 2 || versions.length > BROADCAST_MAX_VARIANTS || themeBusy || mediaBusy) return;
    const isDuplicate = (themes: BroadcastTheme[]) => themes.some(item => item.id !== selectedThemeId && item.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    const before = useAppStore.getState().settings.broadcastThemes || [];
    if (!selectedThemeId && before.length >= BROADCAST_MAX_THEMES) { setThemeError(t("broadcast.themeLimit")); return; }
    if (isDuplicate(before)) { setThemeError(t("broadcast.themeNameTaken")); return; }
    setThemeBusy(true); setThemeError("");
    try {
      await Promise.all(versions.flatMap(version => version.media.map(item => {
        const dataUrl = version.dataUrls[item.id];
        if (!dataUrl) throw new Error(t("broadcast.mediaMissing"));
        return cacheMediaUrl(item.id, dataUrl, true);
      })));
      const current = useAppStore.getState();
      const library = current.settings.broadcastThemes || [];
      if (isDuplicate(library)) { setThemeError(t("broadcast.themeNameTaken")); return; }
      const id = selectedThemeId || crypto.randomUUID();
      const saved: BroadcastTheme = { id, name, variants: versions.map(({ id: versionId, template: body, media: attachments, mediaMode: mode }) => ({ id: versionId, template: body, media: attachments, mediaMode: mode })) };
      const index = library.findIndex(item => item.id === id);
      const next = [...library];
      if (index < 0) next.push(saved); else next[index] = saved;
      current.updateSettings({ broadcastThemes: next });
      await flushPersist(useAppStore.getState);
      setSelectedThemeId(id); setThemeName(name); setThemeEditorOpen(false);
      current.pushToast(t("broadcast.themeSaved"), "success");
    } catch (error) {
      setThemeError(error instanceof Error ? error.message : String(error));
    } finally {
      setThemeBusy(false);
    }
  };
  const deleteSelectedTheme = async () => {
    if (!selectedThemeId || themeBusy || mediaBusy) return;
    const theme = (useAppStore.getState().settings.broadcastThemes || []).find(item => item.id === selectedThemeId);
    if (!theme || !await requestConfirm({
      title: t("broadcast.deleteThemeTitle", { name: theme.name }),
      description: t("broadcast.deleteThemeDescription"),
      confirmLabel: t("common.delete"),
      cancelLabel: t("common.cancel"),
      tone: "danger",
    })) return;

    setThemeBusy(true); setThemeError("");
    try {
      const current = useAppStore.getState();
      current.updateSettings({ broadcastThemes: (current.settings.broadcastThemes || []).filter(item => item.id !== theme.id) });
      await flushPersist(useAppStore.getState);
      setSelectedThemeId(""); setThemeName(""); setThemeEditorOpen(false);
      current.pushToast(t("broadcast.themeDeleted"), "success");
    } catch (error) {
      setThemeError(error instanceof Error ? error.message : String(error));
    } finally {
      setThemeBusy(false);
    }
  };
  const themeLocked = Boolean(selectedThemeId && !themeEditorOpen);
  const [extraGapSec, setExtraGapSec] = useState(BROADCAST_DEFAULT_EXTRA_GAP_SEC);
  const [extraGapMaxSec, setExtraGapMaxSec] = useState(
    BROADCAST_DEFAULT_EXTRA_GAP_MAX_SEC
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);

  const insertTemplateVariable = (variable: "{name}") => {
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

  const [firstContactQuotas, setFirstContactQuotas] = useState<Record<string, number>>();

  const pool = useMemo(() => {
    if (recipientSource !== "contacts") return [];
    const tag = tagFilter.trim().toLowerCase();
    const s = deferredQ.trim().toLowerCase();
    const filtered = contacts.filter((c) => {
      if (c.isGroup) return false;
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
  }, [contacts, accountId, stageFilter, tagFilter, deferredQ, recipientSource]);

  const selectedList = useMemo(
    () => selected.size ? contacts.filter((c) => selected.has(c.id)) : [],
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

  const destinationPhones = useMemo(() => [...new Set([
    ...selectedList.map(contactSendablePhone).filter((phone): phone is string => !!phone),
    ...directPhones,
  ])], [directPhones, selectedList]);
  const routing = useMemo(() => routeBroadcastAccounts({chats,contacts,messages}, destinationPhones, accountId, android ? undefined : firstContactQuotas),
    [chats,contacts,messages,destinationPhones,accountId,android,firstContactQuotas]);
  const destinationAccountIds = [...new Set(Object.values(routing.accountByPhone).filter(Boolean))];
  const campaignAccountId = firstContactQuotas ? destinationAccountIds[0] || accountId : accountId;
  const routingError = !android && routing.unclear ? t("broadcast.routingUnclear",{count:routing.unclear})
    : !android && routing.unassigned ? t("broadcast.routingUnassigned",{count:routing.unassigned}) : "";
  const accountForPhone = (phone: string) => {
    const id = routing.accountByPhone[phone];
    const index = accounts.findIndex(item => item.id === id);
    const target = accounts[index];
    return target ? formatAccountDisplay({label:target.label,userName:target.userName,index1:index+1}) : id || "—";
  };
  const disconnectedAccount = accounts.find(item => destinationAccountIds.includes(item.id) && !isWaAccountConnected(accounts, item.id, liveBaileysAccountId, baileysUi.connection));
  const destinationWarmup = destinationAccountIds.map(id => {
    const target = accounts.find(item => item.id === id);
    return target ? { account: target, warmup: applyAccountWarmup(baseLimits, target.warmupExempt ? undefined : target.createdAt) } : null;
  }).find(item => item?.warmup.active) || null;
  const contactedCount = routing.contacted;
  const newContactCount = destinationPhones.length - contactedCount - routing.unclear;

  const previewRecipients = useMemo(() => {
    const rows: Array<{
      key: string;
      phone: string;
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
        phone,
        label: contact.name.trim() || phone,
        contact,
      });
    }
    for (const phone of directPhones) {
      if (seen.has(phone)) continue;
      seen.add(phone);
      rows.push({
        key: phone,
        phone,
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
  const versionErrors = activeVersions.map(version => {
    const { template, media } = version;
    const templateValidation = validateBroadcastTemplate(template, media.length > 0);
    return template.trim() && media.some(item => item.kind === "audio" && item.voiceNote)
    ? t("broadcast.voiceCaptionUnsupported") : !templateValidation.ok
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
  });
  const invalidVersion = versionErrors.findIndex(Boolean);
  const templateError = invalidVersion < 0 ? "" : randomVersions
    ? `${t("broadcast.variant", { number: invalidVersion + 1 })}：${versionErrors[invalidVersion]}` : versionErrors[invalidVersion];
  const bridgeBlocked = !bridge.connected || !bridge.deviceId ? t("broadcast.connectBridge")
    : activeVersions.some(version => version.media.length > 0) ? t("broadcast.bridgeUnsupported") : "";
  const launchBlockedReason = mediaBusy || themeBusy ? t("broadcast.mediaBusy") : routingError || (!android && !campaignAccountId
    ? t("broadcast.selectAccountRequired")
    : !recipientCount
      ? t("broadcast.addRecipientsRequired")
      : recipientCount > BROADCAST_HARD_CAP
        ? t("broadcast.recipientLimit", { count: BROADCAST_HARD_CAP })
        : templateError
          ? templateError
          : android && bridgeBlocked ? bridgeBlocked
            : !android && destinationWarmup ? t("broadcast.warmupActive")
              : !android && disconnectedAccount
                ? t("broadcast.whatsappDisconnected")
                : running
                  ? t("broadcast.broadcastRunning")
                  : "");

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
    if (mediaBusy) { pushToast(t("broadcast.mediaBusy"), "error"); return false; }
    if (routingError) { pushToast(routingError,"error"); return false; }
    if (!android && !campaignAccountId) {
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
    if (templateError) {
      pushToast(templateError, "error");
      return false;
    }
    return true;
  };

  const launch = async () => {
    if (!validateSetup()) return;
    if (android && bridgeBlocked) { pushToast(bridgeBlocked, "error"); return; }
    if (!android && destinationWarmup) {
      pushToast(
        t("broadcast.editWhileWarmup", {
          label: t("broadcast.warmupLabel", { hours: destinationWarmup.warmup.hoursLeft }),
        }),
        "error"
      );
      return;
    }
    if (android) {
      if (!useAppStore.getState().bridge.connected) {
        pushToast(t("broadcast.connectBridge"), "error");
        return;
      }
    } else if (disconnectedAccount) {
      pushToast(t("broadcast.connectWhatsApp"), "error");
      return;
    }
    const mins = estimateCampaignMinutes(
      recipientCount,
      extraGapSec,
      extraGapMaxSec,
      rateMinIntervalSec ?? 4
    );
    const mediaSummary = randomVersions ? t("broadcast.variantSummary", { count: versions.length }) : media.length > 0
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
        ...(!android ? destinationAccountIds.map(id=>{
          const phones=destinationPhones.filter(phone=>routing.accountByPhone[phone]===id);
          return `${accountForPhone(phones[0])} · ${t("broadcast.confirmRecipients",{count:phones.length,cap:BROADCAST_HARD_CAP})}`;
        }) : [t("broadcast.confirmAccount", {
          account: bridge.deviceName || bridge.deviceId || "Android",
        })]),
        ...(!android ? [t(firstContactQuotas?"broadcast.firstContactRoutingSummary":"planQueue.accountRoutingSummary", { contacted: contactedCount, new: newContactCount })] : []),
        t("broadcast.confirmRecipients", { count: recipientCount, cap: BROADCAST_HARD_CAP }),
        mediaSummary,
        t("broadcast.confirmGap", { min: extraGapSec, max: extraGapMaxSec }),
        t("broadcast.confirmEstimate", { minutes: mins }),
        t("broadcast.confirmTemplate", {
          text: activeVersions.map((v, index) => `${randomVersions ? `${t("broadcast.variant", { number: index + 1 })}：` : ""}${v.template.trim().slice(0, 80)}${v.template.trim().length > 80 ? "…" : ""}`).join("\n"),
        }),
        "",
        t("broadcast.confirmRisk"),
      ].join("\n"),
      confirmLabel: t("broadcast.confirmStartLabel"),
      tone: "danger",
    });
    if (!ok) return;

    // 媒体写入 IDB：战役只存元数据，运行器按需回填 data URL
    try {
      await Promise.all(activeVersions.flatMap(v => v.media.map(m => {
        if (!v.dataUrls[m.id]) throw new Error(t("broadcast.mediaMissing"));
        return cacheMediaUrl(m.id, v.dataUrls[m.id], true);
      })));
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t("broadcast.mediaMissing"), "error");
      return;
    }

    const input = {
      accountId: android ? bridge.deviceId! : campaignAccountId,
      ...(android ? { channelId: "android_bridge" as const } : {}),
      ...(!android ? { firstContactQuotas, expectedAccountByPhone:routing.accountByPhone } : {}),
      template: versions[0].template,
      contactIds: [...selected],
      phoneNumbers: directPhones,
      extraGapSec,
      extraGapMaxSec,
      media: randomVersions ? undefined : versions[0].media,
      mediaMode: randomVersions ? undefined : versions[0].mediaMode,
      variants: randomVersions ? versions.map(({ dataUrls: _dataUrls, ...v }) => v) : undefined,
    };
    let created=createBroadcastCampaign(input);
    if(!created.ok&&created.duplicateIds){
      const duplicateIds=created.duplicateIds;
      if(!await requestConfirm({title:t("planQueue.duplicateTitle"),description:t("planQueue.duplicates",{count:duplicateIds.length}),confirmLabel:t("planQueue.confirmDuplicate"),cancelLabel:t("common.cancel"),tone:"danger"}))return;
      created=createBroadcastCampaign({...input,confirmedDuplicateIds:duplicateIds});
    }
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

      <div className={cn("min-h-0 flex-1 p-4", step === "run" ? "flex flex-col overflow-hidden" : "overflow-y-auto")}>
        {step === "setup" && (
          <div className="mx-auto flex min-h-full w-full max-w-[1440px] flex-col gap-4">
            <div className={cn(
              "grid flex-1 items-stretch divide-y divide-zinc-800 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/20 lg:divide-x lg:divide-y-0",
              randomVersions
                ? "lg:grid-cols-[minmax(250px,0.7fr)_minmax(250px,0.75fr)_minmax(0,2fr)]"
                : "lg:grid-cols-[minmax(250px,0.7fr)_minmax(0,2.75fr)]"
            )}>
              <div className="flex min-w-0 p-4">
                <BroadcastPickStep
                  source={recipientSource}
                  onSourceChange={setRecipientSource}
                  phoneText={phoneText}
                  onPhoneTextChange={setPhoneText}
                  directPhoneCount={directPhones.length}
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
              </div>

              {randomVersions && <section className="flex min-h-0 min-w-0 flex-col p-4">
                <div className="flex items-center justify-between gap-2">
                  <SectionLabel>{t("broadcast.randomVersions")}</SectionLabel>
                  <div className="flex flex-wrap gap-1">
                    {selectedThemeId && !themeEditorOpen && <Button size="xs" variant="secondary" disabled={themeBusy || mediaBusy} onClick={() => { setThemeError(""); setThemeEditorOpen(true); }}>{t("broadcast.editTheme")}</Button>}
                    {selectedThemeId && !themeEditorOpen && <Button size="xs" variant="ghost" className="text-rose-400 hover:text-rose-300" aria-label={t("common.delete")} title={t("common.delete")} disabled={themeBusy || mediaBusy} onClick={() => void deleteSelectedTheme()}><Trash2 className="h-3.5 w-3.5" /></Button>}
                    {!themeEditorOpen && <Button size="xs" variant="secondary" disabled={themeBusy || mediaBusy || broadcastThemes.length >= BROADCAST_MAX_THEMES} title={broadcastThemes.length >= BROADCAST_MAX_THEMES ? t("broadcast.themeLimit") : undefined} onClick={startNewTheme}>{t("broadcast.newTheme")}</Button>}
                  </div>
                </div>
                <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto" aria-label={t("broadcast.theme")}>
                  <button type="button" aria-pressed={!selectedThemeId} disabled={themeBusy || mediaBusy || themeEditorOpen}
                    className={cn("w-full rounded-lg border px-2.5 py-2 text-left text-xs disabled:opacity-50", !selectedThemeId ? "border-brand/40 bg-brand/10 text-brand" : "border-zinc-800/80 text-zinc-300 hover:bg-zinc-800/60")}
                    onClick={() => void loadTheme("")}>{t("broadcast.unsavedTheme")}</button>
                  {broadcastThemes.map(theme => <button key={theme.id} type="button" aria-pressed={selectedThemeId === theme.id} disabled={themeBusy || mediaBusy || themeEditorOpen}
                    className={cn("w-full rounded-lg border px-2.5 py-2 text-left text-xs disabled:opacity-50", selectedThemeId === theme.id ? "border-brand/40 bg-brand/10 text-brand" : "border-zinc-800/80 text-zinc-300 hover:bg-zinc-800/60")}
                    onClick={() => void loadTheme(theme.id)}>
                    <span className="block truncate">{t("broadcast.themeVersionCount", { name: theme.name, count: theme.variants.length })}</span>
                  </button>)}
                </div>
                {themeEditorOpen && <div className="mt-3 shrink-0 space-y-2 border-t border-zinc-800/80 pt-3">
                  <Input value={themeName} maxLength={80} aria-label={t("broadcast.themeName")} placeholder={t("broadcast.themeName")} disabled={themeBusy} onChange={event=>{setThemeName(event.target.value);setThemeError("");}} />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="primary" disabled={themeBusy || mediaBusy || !themeName.trim() || versions.length < 2} onClick={()=>void saveTheme()}>{t(selectedThemeId ? "broadcast.saveTheme" : "broadcast.createTheme")}</Button>
                    <Button size="sm" variant="secondary" disabled={themeBusy} onClick={cancelThemeEdit}>{t("common.cancel")}</Button>
                  </div>
                </div>}
                {themeError&&<p role="alert" className="mt-2 shrink-0 text-2xs text-rose-400">{themeError}</p>}
              </section>}

            <div className="flex h-full min-w-0 flex-col p-4">
              <section className="flex min-h-0 flex-1 flex-col">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <SectionLabel className="!mb-0">{t("broadcast.copy")}</SectionLabel>
                    <Button size="xs" variant="ghost" disabled={themeBusy || themeLocked} title={t("broadcast.copyHint")} aria-label={t("broadcast.copyHint")} onClick={() => insertTemplateVariable("{name}")}>{t("broadcast.name")}</Button>
                  </div>
                  {android ? <span className="text-2xs text-zinc-400">{bridge.deviceName || t("broadcast.connectBridge")}</span> : !firstContactQuotas && <label className="flex min-w-0 items-center gap-2 text-2xs text-zinc-500">
                    <span className="shrink-0">{t("broadcast.newContactAccount")}</span>
                    <select
                      value={accountId}
                      onChange={(event) => {
                        setAccountId(event.target.value);
                      }}
                      className="ui-control h-8 min-w-0 max-w-56 px-2 text-[12px]"
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
                  </label>}
                </div>
                {!android&&<fieldset className="mt-2 space-y-2">
                  <label className="inline-flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={!!firstContactQuotas} onChange={event=>setFirstContactQuotas(event.target.checked?{}:undefined)}/>
                    {t("allocation.title")}
                  </label>
                  {firstContactQuotas&&<>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {accounts.map((item,index)=>{
                        const selected=Object.hasOwn(firstContactQuotas,item.id);
                        const name=formatAccountDisplay({label:item.label,userName:item.userName,index1:index+1});
                        return <div key={item.id} className="flex min-w-0 items-center gap-2 text-xs">
                          <label className="flex min-w-0 flex-1 items-center gap-2">
                            <input type="checkbox" checked={selected} onChange={event=>{
                              const next={...firstContactQuotas};
                              if(event.target.checked)next[item.id]=0;else delete next[item.id];
                              setFirstContactQuotas(next);
                            }}/>
                            <span className="truncate">{name}</span>
                          </label>
                          <input type="number" className="ui-control w-16 px-2 py-1" min={0} max={BROADCAST_HARD_CAP} disabled={!selected}
                            aria-label={t("allocation.quota",{name})} value={selected?firstContactQuotas[item.id]:""}
                            onChange={event=>setFirstContactQuotas({...firstContactQuotas,[item.id]:Math.max(0,Math.min(BROADCAST_HARD_CAP,Math.trunc(Number(event.target.value)||0)))})}/>
                        </div>;
                      })}
                    </div>
                    <p className="text-2xs text-zinc-500">{t("broadcast.firstContactRoutingHint")}</p>
                    {routingError&&<p role="status" className="text-xs text-amber-500">{routingError}</p>}
                  </>}
                </fieldset>}
                <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label={t("broadcast.contentMode")}>
                  <Button size="sm" variant={!randomVersions ? "primary" : "secondary"} disabled={mediaBusy || themeBusy} aria-pressed={!randomVersions}
                    onClick={() => setRandomVersions(false)}>{t("broadcast.fixedContent")}</Button>
                  <Button size="sm" variant={randomVersions ? "primary" : "secondary"} disabled={mediaBusy || themeBusy} aria-pressed={randomVersions}
                    onClick={() => {
                      if (versions.length === 1) setVersions(all => [...all, newVariant()]);
                      setRandomVersions(true);
                    }}>{t("broadcast.randomVersions")}</Button>
                </div>
                {randomVersions && <div className="mt-2 flex flex-wrap items-center gap-1 border-b border-zinc-800/80 pb-2" role="tablist" aria-label={t("broadcast.randomVersions")}>
                  {versions.map((v, index) => <button key={v.id} type="button" role="tab" aria-selected={v.id === currentVersion.id} disabled={mediaBusy || themeBusy}
                    className={cn("rounded-lg px-2.5 py-1.5 text-xs disabled:opacity-40", v.id === currentVersion.id ? "bg-brand/15 text-brand" : "text-zinc-500 hover:bg-zinc-800")}
                    onClick={() => setVersionId(v.id)}>{t("broadcast.variant", { number: index + 1 })}{versionErrors[index] ? " · !" : ""}</button>)}
                  <Button size="sm" variant="ghost" disabled={mediaBusy || themeBusy || themeLocked || versions.length >= BROADCAST_MAX_VARIANTS}
                    onClick={() => { const v = newVariant(); setVersions(all => [...all, v]); setVersionId(v.id); }}>{t("broadcast.addVariant")}</Button>
                  <Button size="sm" variant="ghost" disabled={mediaBusy || themeBusy || themeLocked || versions.length <= 1}
                    onClick={() => {
                      setVersions(all => all.filter(v => v.id !== currentVersion.id));
                      setVersionId("");
                      if (versions.length === 2) setRandomVersions(false);
                    }}>{t("broadcast.removeVariant")}</Button>
                </div>}
                <div className="mt-1 flex items-center gap-1.5 text-2xs text-zinc-500">
                  <span>{t(firstContactQuotas?"broadcast.firstContactRoutingSummary":"planQueue.accountRoutingSummary", { contacted: contactedCount, new: newContactCount })}</span>
                  <span role="note" tabIndex={0} className="inline-flex cursor-help rounded p-1" title={[randomVersions ? t("broadcast.variantHint") : "", t(firstContactQuotas?"broadcast.firstContactRoutingHint":"planQueue.accountRoutingHint")].filter(Boolean).join("\n")} aria-label={[randomVersions ? t("broadcast.variantHint") : "", t(firstContactQuotas?"broadcast.firstContactRoutingHint":"planQueue.accountRoutingHint")].filter(Boolean).join(". ")}><Info className="h-3.5 w-3.5" /></span>
                </div>
                <fieldset disabled={themeBusy || themeLocked} className="flex min-h-0 flex-1 flex-col border-0 p-0">
                  <Textarea
                    ref={templateRef}
                    value={template}
                    onChange={(event) => setTemplate(event.target.value)}
                    rows={4}
                    className="mt-2 min-h-28 max-h-[48vh] flex-1 resize-y"
                  />
                  <div className="mt-2 border-t border-zinc-800/80 pt-2">
                    <div className="mb-1 text-2xs text-zinc-500">
                      {t("broadcast.mediaHint")}
                    </div>
                    <BroadcastMediaPicker
                      key={currentVersion.id}
                      media={media}
                      mediaMode={mediaMode}
                      dataUrls={mediaDataUrls}
                      onBusyChange={setMediaBusy}
                      onChange={(nextMedia, nextMode, dataUrls) => {
                        updateVersion({ media: nextMedia, mediaMode: nextMode, dataUrls });
                      }}
                    />
                  </div>
                </fieldset>
              </section>

              <section className="mt-auto shrink-0 border-t border-zinc-800/80 pt-3">
                <div className="flex items-center justify-between gap-2">
                  <SectionLabel>{t("broadcast.preview")}</SectionLabel>
                  {randomVersions && <span className="text-xs text-brand">{t("broadcast.variant", { number: currentVersionNumber })}</span>}
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
                        {!android && ` · ${accountForPhone(previewRecipient.phone)}`}
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

            </div>

            </div>

            <section className="flex flex-wrap items-center gap-3 rounded-lg border border-brand/30 bg-zinc-900/95 p-3">
                <div className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-2 text-2xs text-zinc-500">
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
                <div role="group" aria-label={t("broadcast.gap")} className="flex items-center gap-2 text-2xs text-zinc-500">
                  <span className="shrink-0">{t("broadcast.gap")}</span>
                  <div><SettingsNumberInput ariaLabel={t("broadcast.minGap")} min={20} max={120} integer value={extraGapSec}
                    onCommit={value => {
                      setExtraGapSec(value);
                      setExtraGapMaxSec(current => Math.max(current, value));
                    }} className="h-8 !w-16" /></div>
                  <span>{t("broadcast.to")}</span>
                  <div><SettingsNumberInput ariaLabel={t("broadcast.maxGap")} min={extraGapSec} max={120} integer value={extraGapMaxSec}
                    onCommit={setExtraGapMaxSec} className="h-8 !w-16" /></div>
                </div>
                {destinationWarmup && (
                  <p className="order-last w-full text-2xs text-sky-300">
                    {t("broadcast.warmupBlocked", {
                      label: t("broadcast.warmupLabel", { hours: destinationWarmup.warmup.hoursLeft }),
                    })}
                  </p>
                )}
                {recipientCount > BROADCAST_HARD_CAP && (
                  <p className="order-last w-full text-2xs text-rose-300">
                    {t("broadcast.overLimit", { count: recipientCount - BROADCAST_HARD_CAP })}
                  </p>
                )}
                <p className="flex min-w-48 flex-1 items-center gap-1.5 text-2xs text-amber-300/80">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {t("broadcast.riskWarning")}
                </p>
                <Button
                  variant="primary"
                  className="w-full !min-h-10 sm:w-auto sm:min-w-48"
                  disabled={Boolean(launchBlockedReason)}
                  onClick={() => void launch()}
                >
                  {launchBlockedReason || t("broadcast.start")}
                </Button>
            </section>
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
            onRetryFailed={async (ids, unknown) => {
              const failed = watching.items.filter((item) => item.status === "failed" && ids.includes(item.id)).length;
              if (!failed) return;
              const ok = await requestConfirm({
                  title: t("broadcast.retryFailedTitle", { count: failed }),
                  description: t(unknown ? "broadcast.retryFailedDescription" : "planQueue.retrySelectedHint"),
                  confirmLabel: t("broadcast.retryFailedConfirm"),
                tone: "danger",
              });
              if (!ok) return;
              const count=retryFailedBroadcastCampaign(watching.id,ids,unknown&&ids.length===1?ids:[]);
              if (!count) return;
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
                const needsAttention = c.items.filter(item => item.status === "pending" && Boolean(item.error || item.errorCode)).length;
                const pending = Math.max(0, p.pending - needsAttention);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      title={t("broadcast.run.openRecord")}
                      className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-left text-[12px] hover:border-zinc-700"
                      onClick={() => {
                        setActiveId(c.id);
                        setStep("run");
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate text-zinc-200">
                        {c.title || c.template.slice(0, 28)}
                        <span className="ml-2 text-2xs text-zinc-500">
                          {t(c.status === "done" ? "broadcast.run.item.sent" : c.status === "running" ? "broadcast.run.item.sending" : c.status === "paused" ? "broadcast.run.pause" : c.status === "cancelled" ? "broadcast.run.item.skipped" : "broadcast.run.item.pending")}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-wrap gap-x-2.5 tabular-nums text-2xs">
                        <span className="text-emerald-400">{t("broadcast.run.sent", { count: p.sent })}</span>
                        <span className={p.failed ? "text-rose-400" : "text-zinc-500"}>{t("broadcast.run.failed", { count: p.failed })}</span>
                        {needsAttention > 0 && <span className="text-amber-300">{t("broadcast.run.needsAttention", { count: needsAttention })}</span>}
                        <span className={pending ? "text-amber-300" : "text-zinc-500"}>{t("broadcast.run.pending", { count: pending })}</span>
                        <span className="text-zinc-500">{t("broadcast.run.skipped", { count: p.skipped })}</span>
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
