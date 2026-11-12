import { resolveAutoReplyScope } from "@/lib/autoReplyScope";
import { useAutoReplyRuntime } from "@/lib/autoReplyRuntime";
import {
  CalendarPlus,
  Check,
  ChevronDown,
  Copy,
  Loader2,
  PanelRightClose,
  RefreshCw,
  ShoppingCart,
  Sparkles,
  TableProperties,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "@/store/appStore";
import { cn, displayContactLabel, displayPhone, resolveSendTarget } from "@/lib/utils";
import {
  baileysCreateLabel,
  baileysLabels,
  baileysSetChatLabel,
} from "@/lib/baileys";
import { generateSuggestions, getSuggestionContextKey, hasRealAiKey, type GenerateSuggestionsResult } from "@/lib/aiSuggest";
import { createSuggestionCache, isManualSuggestionContext, SUGGESTION_MAX_AGE_MS } from "@/lib/aiSuggestionCache";
import { resolveAiReplyProfile } from "@/lib/aiPromptScope";
import { PlaybookBinding } from "./PlaybookBinding";
import type { Message, WhatsAppLabel } from "@/types/crm";
import { ContactAvatar } from "./ContactAvatar";
import { GoogleSheetInfo } from "./GoogleSheetInfo";
import { ContactLocalTime } from "./ContactLocalTime";
import { Button, SectionLabel } from "@/components/ui/primitives";
import { ContactTagsNotesEditor } from "./ContactTagsNotesEditor";
import { PersonMultiAccountPanel } from "./PersonMultiAccountPanel";
import { CommonGroupsPanel } from "./CommonGroupsPanel";
import { WhatsAppLabelMenu } from "@/components/chat/WhatsAppLabelMenu";
import { workflowForStage } from "@/lib/contactWorkflow";
import { SalesStageField } from "./SalesStageField";
import { filterMessagesForAccount } from "@/lib/personThreads";
import { isWaAccountConnected, resolveWaSendAccountId } from "@/lib/accountConnection";
import { formatAccountDisplay } from "@/lib/accountLabels";
import { QuickReplyBrowser } from "@/components/chat/QuickReplyBrowser";
import { useI18n } from "@/i18n";
import { emitQuickReplyMedia } from "@/lib/quickReplyMedia";
import { ImageLibraryPanel } from "@/components/chat/ImageLibraryPanel";
import { AiSuggestionCard } from "./AiSuggestionCard";
import { AiSuggestionReadingControl } from "./AiSuggestionReadingControl";
import { resolveMyLang } from "@/lib/translateDraft";
import { AiSheetExtractDialog } from "./AiSheetExtractDialog";
import {MuseQueueStatus} from "@/components/settings/MuseQueueStatus";

function threadForContact(
  messages: Message[],
  contactId?: string | null,
  chatId?: string | null
) {
  if (!contactId && !chatId) return [];
  return messages
    .filter(
      (message) =>
        (chatId && message.chatId === chatId) ||
        (contactId && message.contactId === contactId) ||
        (contactId && message.chatId === `bridge-chat-${contactId}`)
    )
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
}

export function CrmAiPanel() {
  const { t } = useI18n();
  const contacts = useAppStore((state) => state.contacts);
  const followUps = useAppStore((state) => state.followUps);
  const selectedContactId = useAppStore((state) => state.selectedContactId);
  const selectedChatId = useAppStore((state) => state.selectedChatId);
  const autoRuntime = useAutoReplyRuntime(state => selectedChatId ? state.byChat[selectedChatId] : undefined);
  const threadBucket = useAppStore((state) =>
    selectedChatId ? state.messagesByChatId[selectedChatId] : undefined
  );
  const selectedThreadAccount = useAppStore(
    (state) => state.selectedThreadAccount
  );
  const chats = useAppStore((state) => state.chats);
  const phones = useAppStore((state) => state.phones);
  const toggleQuickReplyPin = useAppStore(state => state.toggleQuickReplyPin);
  const recordQuickReplyUsage = useAppStore(state => state.recordQuickReplyUsage);
  const openContactWorkspace = useAppStore(
    (state) => state.openContactWorkspace
  );
  const setSelectedChat = useAppStore((state) => state.setSelectedChat);
  const aiSuggestions = useAppStore((state) => state.aiSuggestions);
  const settings = useAppStore((state) => state.settings);
  const baileysUi = useAppStore((state) => state.baileysUi);
  const applyAiSuggestion = useAppStore((state) => state.applyAiSuggestion);
  const updateContact = useAppStore((state) => state.updateContact);
  const toggleFollowUp = useAppStore((state) => state.toggleFollowUp);
  const scheduleTomorrowFollowUp = useAppStore(
    (state) => state.scheduleTomorrowFollowUp
  );
  const scheduleFollowUp = useAppStore((state) => state.scheduleFollowUp);
  const syncWhatsAppLabels = useAppStore(
    (state) => state.syncWhatsAppLabels
  );
  const setActiveNav = useAppStore((state) => state.setActiveNav);
  const pushToast = useAppStore((state) => state.pushToast);
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen);
  const collapsed = useAppStore((s) => s.crmPanelCollapsed);
  const setCrmPanelCollapsed = useAppStore((s) => s.setCrmPanelCollapsed);
  const panelTab = useAppStore((s) => s.crmPanelTab);
  const setPanelTab = useAppStore((s) => s.setCrmPanelTab);
  const setCollapsed = setCrmPanelCollapsed;
  // 未选会话：收起右侧，中间欢迎区更宽（对齐官方空白主区）
  useLayoutEffect(() => {
    if (!selectedChatId && !selectedContactId) setCrmPanelCollapsed(true);
  }, [selectedChatId, selectedContactId, setCrmPanelCollapsed]);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [sheetInfoOpen, setSheetInfoOpen] = useState(false);
  const [moreDetailsOpen, setMoreDetailsOpen] = useState(false);
  const [followSchedulerOpen, setFollowSchedulerOpen] = useState(false);
  const [followDate, setFollowDate] = useState("");
  const [followTime, setFollowTime] = useState("10:00");
  const [followNote, setFollowNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [aiSource, setAiSource] = useState<string>(settings.aiProvider);
  const [aiError, setAiError] = useState("");
  const [sheetExtractOpen, setSheetExtractOpen] = useState(false);
  const [readingLanguage, setReadingLanguage] = useState("");
  const [readingTarget, setReadingTarget] = useState<string | null>(null);
  const [suggestionExpansion,setSuggestionExpansion]=useState<{key:string;open:boolean}|null>(null);
  const generation = useRef(0);
  const [suggestionCache] = useState(createSuggestionCache);
  const visibleSuggestionExpiry = useRef<{ key: string; expiresAt: number } | null>(null);

  const contact = contacts.find((item) => item.id === selectedContactId);
  const threadAccountId =
    selectedThreadAccount?.chatId === selectedChatId
      ? selectedThreadAccount.accountId
      : null;
  const aiAccountId =
    threadAccountId ||
    chats.find((chat) => chat.id === selectedChatId)?.accountId ||
    contact?.accountId;
  const quickReplyChat = chats.find(chat => chat.id === selectedChatId);
  const quickReplyAccountId = resolveWaSendAccountId(settings.waAccounts, aiAccountId || settings.liveBaileysAccountId || settings.activeAccountId, settings.liveBaileysAccountId, baileysUi.connection)
    || settings.liveBaileysAccountId || settings.activeAccountId || "wa-default";
  const quickReplyAccount = settings.waAccounts?.find(account => account.id === quickReplyAccountId);
  const quickReplyIdentity = settings.sendChannel === "android_bridge"
    ? t("quickShelf.device", { device: phones?.find(phone => phone.id === quickReplyChat?.phoneId)?.name || quickReplyChat?.phoneId || t("quickShelf.unknownAccount") })
    : quickReplyAccount ? formatAccountDisplay(quickReplyAccount) : quickReplyAccountId;
  const thread = useMemo(() => {
    // 用 messagesByChatId 索引桶（已按 chatId 分组 + sentAt 排序），避免全量扫 messages
    if (!threadBucket?.length) return [];
    return filterMessagesForAccount(
      threadForContact(threadBucket, selectedContactId, selectedChatId),
      threadAccountId,
      settings.liveBaileysAccountId
    );
  }, [
    threadBucket,
    selectedChatId,
    selectedContactId,
    threadAccountId,
    settings.liveBaileysAccountId,
  ]);
  const lastIn = useMemo(
    () => [...thread].reverse().find((message) => message.direction === "in"),
    [thread]
  );
  const activeOrder = useMemo(
    () =>
      [...thread]
        .reverse()
        .find(
          (message) =>
            message.direction === "in" && message.mediaType === "order"
        ),
    [thread]
  );
  const openFollowUps = useMemo(
    () =>
      followUps
        .filter((followUp) => followUp.contactId === selectedContactId && !followUp.done)
        .sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
    [followUps, selectedContactId]
  );
  const workflow = contact ? workflowForStage(contact.stage) : null;
  const meta = contact
    ? [
        ["\u516c\u53f8", contact.company],
        ["\u56fd\u5bb6", contact.country],
        ["\u6765\u6e90", contact.source],
      ].filter((item): item is [string, string] => Boolean(item[1]))
    : [];
  const isBaileys = settings.sendChannel === "baileys";
  const labelAccountId =
    aiAccountId ||
    settings.liveBaileysAccountId ||
    settings.activeAccountId;
  const labelAccountConnected = isWaAccountConnected(
    settings.waAccounts,
    labelAccountId,
    settings.liveBaileysAccountId,
    baileysUi.connection
  );
  const whatsappLabels = labelAccountId
    ? baileysUi.labelsByAccountId[labelAccountId] || []
    : [];
  const aiReady = hasRealAiKey(settings);
  const replyScope = resolveAutoReplyScope(settings, selectedChatId || "");

  const aiProfile = resolveAiReplyProfile(settings, aiAccountId, selectedChatId || undefined);
  const needsHuman=replyScope.mode==="auto"&&autoRuntime?.phase==="human"&&autoRuntime.inboundId===lastIn?.id&&(!autoRuntime.accountId||autoRuntime.accountId===aiAccountId);
  const expansionKey=JSON.stringify([selectedChatId,aiAccountId,replyScope.mode,needsHuman?lastIn?.id:""]);
  const suggestionsOpen=suggestionExpansion?.key===expansionKey?suggestionExpansion.open:replyScope.mode!=="auto"||needsHuman;
  const [planClock,setPlanClock]=useState(0);
  useEffect(()=>{if(!settings.aiPlaybookPlans?.length)return;const timer=window.setInterval(()=>setPlanClock(Date.now()),30000);return()=>window.clearInterval(timer);},[settings.aiPlaybookPlans?.length]);
  const baseSuggestionKey=useMemo(()=>getSuggestionContextKey(contact,thread,settings,aiAccountId,{chatId:selectedChatId||undefined}),[selectedChatId,selectedContactId,contact,thread,settings,aiAccountId,planClock]);
  const suggestionKey = useMemo(() => getSuggestionContextKey(contact, thread, settings, aiAccountId, { chatId: selectedChatId || undefined,count:1 }),
    [selectedChatId, selectedContactId, contact, thread, settings, aiAccountId,planClock]);
  const latestSuggestionKey = useRef(suggestionKey);
  latestSuggestionKey.current = suggestionKey;

  useEffect(() => {
    if (!aiSuggestions.length || collapsed || panelTab !== "customer") return;
    const entry = suggestionCache.get(suggestionKey);
    const expiresAt = entry?.expiresAt || (visibleSuggestionExpiry.current?.key === suggestionKey ? visibleSuggestionExpiry.current.expiresAt : undefined);
    const expire = () => {
      if (latestSuggestionKey.current !== suggestionKey || suggestionCache.get(suggestionKey)) return;
      if (visibleSuggestionExpiry.current?.key === suggestionKey && Date.now() < visibleSuggestionExpiry.current.expiresAt) {
        window.setTimeout(expire, visibleSuggestionExpiry.current.expiresAt - Date.now());
        return;
      }
      generation.current++;
      useAppStore.setState({ aiSuggestions: [] });
      setLoading(false);
      setAiError(t("crmPanel.suggestionsExpired"));
    };
    if (!expiresAt) return;
    const timer = window.setTimeout(expire, Math.max(0, expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [aiSuggestions, suggestionKey, collapsed, panelTab, suggestionCache, settings.uiLanguage]);

  const requestSuggestions = (key: string, force = false, onProgress?: (result: GenerateSuggestionsResult) => void) => suggestionCache.request(key,
    (publish, signal) => generateSuggestions(contact, thread, settings, { accountId: aiAccountId, chatId: selectedChatId || undefined, count:1, onProgress: publish, signal }), force, onProgress);

  const showProgress = (key: string, request: number) => (result: GenerateSuggestionsResult) => {
    const entry = suggestionCache.get(key);
    if (request !== generation.current || latestSuggestionKey.current !== key || !entry) return;
    visibleSuggestionExpiry.current = { key, expiresAt: entry.expiresAt };
    useAppStore.setState({ aiSuggestions: result.suggestions });
    setAiSource(result.source);
  };


  const formatFollowDue = (raw?: string) => {
    if (!raw) return "";
    const s = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
      const [d, t] = s.split("T");
      return `${d} ${t.slice(0, 5)}`;
    }
    return s.slice(0, 10);
  };

  const defaultFollowDraft = () => {
    const base = openFollowUps[0]?.dueAt;
    if (base && /^\d{4}-\d{2}-\d{2}/.test(base)) {
      const date = base.slice(0, 10);
      const time = base.includes("T") ? base.slice(11, 16) : "10:00";
      return { date, time };
    }
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return { date: `${y}-${m}-${day}`, time: "10:00" };
  };

  const openFollowScheduler = () => {
    const draft = defaultFollowDraft();
    setFollowDate(draft.date);
    setFollowTime(draft.time);
    setFollowNote(
      openFollowUps[0]?.note ||
        `${workflow?.tomorrowNote || t("crmPanel.followUp")}${lastIn ? ` · ${lastIn.body.slice(0, 45)}` : ""}`
    );
    setFollowSchedulerOpen(true);
  };

  const commitFollowSchedule = () => {
    if (!contact) return;
    if (!followDate) {
      pushToast(t("crmPanel.selectDate"), "error");
      return;
    }
    const time = followTime || "10:00";
    const dueAt = `${followDate}T${time}`;
    const result = scheduleFollowUp(contact.id, dueAt, followNote.trim() || undefined);
    if (result) {
      pushToast(t("crmPanel.followUpSet", { due: formatFollowDue(result.dueAt) }), "success");
      setFollowSchedulerOpen(false);
    }
  };

  useEffect(() => {
    setTagsOpen(false);
    setFollowSchedulerOpen(false);
    setFollowNote("");
    setAiError("");
    useAppStore.setState({ aiSuggestions: [] });
  }, [selectedChatId, selectedContactId]);

  const refreshAi = async () => {
    if (!contact) return pushToast("\u8bf7\u5148\u9009\u62e9\u4f1a\u8bdd", "info");
    if (!aiReady) {
      useAppStore.setState({ aiSuggestions: [] });
      setAiSource("unconfigured");
      return;
    }
    const request = ++generation.current;
    const key = suggestionKey;
    setLoading(true);
    setAiError("");
    try {
      const result = await requestSuggestions(key, true, showProgress(key, request));
      if (request !== generation.current || latestSuggestionKey.current !== key) return;
      if (result.suggestions.length) visibleSuggestionExpiry.current = { key, expiresAt: suggestionCache.get(key)?.expiresAt || Date.now() + SUGGESTION_MAX_AGE_MS };
      useAppStore.setState({ aiSuggestions: result.suggestions });
      setAiSource(result.source);
      setAiError(result.error || "");
      setSuggestionExpansion({key:expansionKey,open:true});
      pushToast(
        result.fallback ? result.error || "API \u4e0d\u53ef\u7528" : "\u5df2\u751f\u6210\u56de\u590d\u5efa\u8bae",
        result.fallback ? "error" : "success"
      );
    } catch (error) {
      if (request !== generation.current || latestSuggestionKey.current !== key) return;
      setAiError(error instanceof Error?error.message:t("crmPanel.suggestionError",{error:String(error)}));
      pushToast(error instanceof Error ? error.message : "\u751f\u6210\u5efa\u8bae\u5931\u8d25", "error");
    } finally {
      if (request === generation.current && latestSuggestionKey.current === key) setLoading(false);
    }
  };

  useEffect(() => {
    const request = ++generation.current;
    const key = suggestionKey;
    if(visibleSuggestionExpiry.current?.key!==key){useAppStore.setState({ aiSuggestions: [] });setAiError("");}
    if (collapsed || panelTab !== "customer" || !contact || !aiReady || !suggestionsOpen || replyScope.mode==="auto") {
      setLoading(false);
      return () => { generation.current++; suggestionCache.cancelPending(key); };
    }
    const entry = suggestionCache.get(key);
    const cached = entry?.result;
    if (cached) {
      useAppStore.setState({ aiSuggestions: cached.suggestions });
      setAiSource(cached.source);
      setAiError("");
      setLoading(false);
      return () => { generation.current++; suggestionCache.cancelPending(key); };
    }
    if(visibleSuggestionExpiry.current?.key===key&&!entry&&useAppStore.getState().aiSuggestions.length){setLoading(false);return()=>{generation.current++;suggestionCache.cancelPending(key);};}
    if (isManualSuggestionContext(baseSuggestionKey)) {
      setLoading(false);
      return () => { generation.current++; suggestionCache.cancelPending(key); };
    }
    let cancelled = false;
    setLoading(true);
    setAiError("");
    const timer = window.setTimeout(() => {
      if (request !== generation.current || latestSuggestionKey.current !== key) return;
      if (isManualSuggestionContext(baseSuggestionKey)) { setLoading(false); return; }
      void requestSuggestions(key, false, showProgress(key, request))
        .then((result) => {
          if (cancelled || request !== generation.current || latestSuggestionKey.current !== key) return;
          if (result.suggestions.length) visibleSuggestionExpiry.current = { key, expiresAt: suggestionCache.get(key)?.expiresAt || Date.now() + SUGGESTION_MAX_AGE_MS };
          useAppStore.setState({ aiSuggestions: result.suggestions });
          setAiSource(result.source);
          setAiError(result.error || "");
          setLoading(false);
        })
        .catch((error) => {
          if (!cancelled && request === generation.current && latestSuggestionKey.current === key) {
            setAiError(error instanceof Error ? error.message : t("crmPanel.suggestionError", { error: String(error) }));
            setLoading(false);
          }
        });
    }, suggestionCache.get(key) ? 0 : 500);
    return () => {
      cancelled = true;
      generation.current++;
      window.clearTimeout(timer);
      suggestionCache.cancelPending(key);
    };
    // 已发出的消息也更新下一句建议；未发出的内容不改变上下文或重复请求。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    collapsed,
    panelTab,
    suggestionKey,
    aiReady,
    suggestionsOpen,
    replyScope.mode,
  ]);

  const refreshLabels = async () => {
    if (!labelAccountId) return;
    const result = await baileysLabels(labelAccountId);
    syncWhatsAppLabels(
      result.labels || [],
      result.chatLabelIds || {},
      labelAccountId
    );
  };

  useEffect(() => {
    if (collapsed || !contact || !isBaileys || !labelAccountConnected) return;
    let cancelled = false;
    void baileysLabels(labelAccountId)
      .then((result) => {
        if (!cancelled) {
          syncWhatsAppLabels(
            result.labels || [],
            result.chatLabelIds || {},
            labelAccountId
          );
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [
    collapsed,
    contact?.id,
    isBaileys,
    labelAccountConnected,
    labelAccountId,
    syncWhatsAppLabels,
  ]);

  const toggleLabel = async (label: WhatsAppLabel, enabled: boolean) => {
    if (!contact) throw new Error("No contact");
    const recipient = resolveSendTarget({
      phone: contact.phone,
      channelAddress: contact.channelAddress,
      entityId: contact.id,
    });
    if (!recipient) throw new Error("No WhatsApp recipient");
    try {
      await baileysSetChatLabel(
        recipient,
        label.id,
        enabled,
        labelAccountId
      );
      await refreshLabels();
      pushToast(`${enabled ? "\u5df2\u6dfb\u52a0" : "\u5df2\u79fb\u9664"}\u6807\u7b7e\u300c${label.name}\u300d`, "success");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "\u6807\u7b7e\u66f4\u65b0\u5931\u8d25", "error");
      throw error;
    }
  };

  const createLabel = async (name: string, color: number) => {
    try {
      await baileysCreateLabel(name, color, labelAccountId);
      await refreshLabels();
      pushToast(`\u5df2\u521b\u5efa\u6807\u7b7e\u300c${name}\u300d`, "success");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "\u6807\u7b7e\u521b\u5efa\u5931\u8d25", "error");
      throw error;
    }
  };

  const copyOrder = async () => {
    if (!activeOrder) return;
    try {
      await navigator.clipboard.writeText(activeOrder.body);
      pushToast("\u8ba2\u5355\u5df2\u590d\u5236", "success");
    } catch {
      pushToast("\u590d\u5236\u5931\u8d25", "error");
    }
  };

  if (collapsed) {
    return null;
  }

  return (
    <aside
      id="crm-workspace-panel"
      className="crm-panel flex w-[320px] shrink-0 flex-col border-l border-zinc-800/90 bg-zinc-950"
    >
      <div className="flex h-11 items-center justify-between border-b border-zinc-800/90 px-3">
        <span className="text-[13px] font-semibold">{t("crmPanel.title")}</span>
        <button
          type="button"
          onClick={() => {
            setCollapsed(true);
            setPanelTab("customer");
          }}
          className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          title={t("crmPanel.collapse")}
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>

      <div
        className="grid grid-cols-3 gap-1 border-b border-zinc-800/90 p-1.5"
        role="tablist"
        aria-label={t("crmPanel.title")}
      >
        <button
          type="button"
          role="tab"
          aria-selected={panelTab === "customer"}
          className={cn(
            "rounded-lg px-2 py-1.5 text-[11px] transition-colors",
            panelTab === "customer"
              ? "bg-zinc-800 text-zinc-100"
              : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
          )}
          onClick={() => setPanelTab("customer")}
        >
          {t("crmPanel.customer")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={panelTab === "quick-replies"}
          className={cn(
            "rounded-lg px-2 py-1.5 text-[11px] transition-colors",
            panelTab === "quick-replies"
              ? "bg-zinc-800 text-brand"
              : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
          )}
          onClick={() => setPanelTab("quick-replies")}
        >
          {t("crmPanel.quickReplies")}
        </button>
        <button type="button" role="tab" aria-selected={panelTab === "images"} className={cn("rounded-lg px-2 py-1.5 text-[11px] transition-colors", panelTab === "images" ? "bg-zinc-800 text-brand" : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300")} onClick={() => setPanelTab("images")}>{t("gallery.title")}</button>
      </div>

      {panelTab === "images" ? <ImageLibraryPanel chatId={selectedChatId} contextKey={[selectedChatId, quickReplyAccountId, settings.sendChannel, quickReplyChat?.phoneId].join(":")} /> : panelTab === "customer" ? (
        <>
      <section className="min-h-0 flex-1 overflow-y-auto p-3">
        {!contact ? (
          <p className="py-8 text-center text-2xs text-zinc-600">{t("crmPanel.selectChat")}</p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-start gap-2.5">
              <ContactAvatar key={`${contact.id}:${aiAccountId}`} contact={contact} accountId={aiAccountId} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold">
                  {displayContactLabel(
                    contact.name,
                    contact.phone,
                    contact.channelAddress,
                    lastIn?.body,
                    { isGroup: !!contact.isGroup }
                  )}
                </div>
                <div className="truncate text-2xs text-zinc-500">
                  {displayPhone(contact.phone) || t("crmPanel.whatsappLid")}
                </div>
                <ContactLocalTime contact={contact} />
              </div>
            </div>

            {meta.length > 0 && (
              <div className={cn("grid gap-1.5", meta.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
                {meta.map(([label, value]) => <Meta key={label} label={label} value={value} />)}
              </div>
            )}

            <SalesStageField value={contact.stage} onChange={stage => updateContact(contact.id, { stage })} />
            {selectedChatId && <PlaybookBinding accountId={aiAccountId} chatId={selectedChatId}/>}

            {activeOrder && contact.stage !== "won" && contact.stage !== "after_sales" && (
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-2.5">
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-amber-200">
                  <ShoppingCart className="h-3.5 w-3.5" />
                  {t("crmPanel.pendingOrder")}
                </div>
                <p className="whitespace-pre-line text-[11px] leading-4 text-zinc-400">{activeOrder.body}</p>
                <div className="mt-2 flex gap-1.5">
                  <Button variant="secondary" className="!min-h-7 gap-1 !px-2 text-2xs" onClick={() => void copyOrder()}>
                    <Copy className="h-3 w-3" />{t("crmPanel.copy")}
                  </Button>
                  <Button
                    variant="secondary"
                    className="!min-h-7 !px-2 text-2xs"
                    onClick={() => {
                      const detail = activeOrder.body.replace(/^\[\u8ba2\u5355\]\s*/, "");
                      applyAiSuggestion(`\u60a8\u597d\uff0c\u5df2\u6536\u5230\u60a8\u7684\u8ba2\u5355\uff1a\n${detail}\n\u6211\u6b63\u5728\u786e\u8ba4\u5e93\u5b58\u548c\u6700\u7ec8\u62a5\u4ef7\uff0c\u7a0d\u540e\u56de\u590d\u60a8\u3002`);
                    }}
                  >
                    {t("crmPanel.generateQuote")}
                  </Button>
                </div>
              </div>
            )}

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-2.5">
              <div className="mb-1 flex items-center justify-between text-2xs text-zinc-500">
                <span>{t("crmPanel.followUpPlan")}</span>
                {openFollowUps[0] && (
                  <span className="tabular-nums text-zinc-400">
                    {formatFollowDue(openFollowUps[0].dueAt)}
                  </span>
                )}
              </div>
              <p className="line-clamp-2 text-[11px] text-zinc-300">
                {openFollowUps[0]?.note || t("crmPanel.noFollowUp")}
              </p>

              {followSchedulerOpen ? (
                <div className="mt-2 space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/50 p-2.5">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-[10px] text-zinc-500">
                      {t("crmPanel.date")}
                      <input
                        type="date"
                        value={followDate}
                        min={new Date().toISOString().slice(0, 10)}
                        onChange={(e) => setFollowDate(e.target.value)}
                        className="ui-control mt-1 h-8 w-full px-2 text-[12px]"
                      />
                    </label>
                    <label className="block text-[10px] text-zinc-500">
                      {t("crmPanel.time")}
                      <input
                        type="time"
                        value={followTime}
                        onChange={(e) => setFollowTime(e.target.value)}
                        className="ui-control mt-1 h-8 w-full px-2 text-[12px]"
                      />
                    </label>
                  </div>
                  <label className="block text-[10px] text-zinc-500">
                    {t("crmPanel.optionalNote")}
                    <input
                      value={followNote}
                      onChange={(e) => setFollowNote(e.target.value)}
                      placeholder={t("crmPanel.notePlaceholder")}
                      className="ui-control mt-1 h-8 w-full px-2 text-[12px]"
                    />
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      variant="secondary"
                      className="!min-h-7 !px-2 text-2xs"
                      onClick={() => {
                        const d = new Date();
                        const y = d.getFullYear();
                        const m = String(d.getMonth() + 1).padStart(2, "0");
                        const day = String(d.getDate()).padStart(2, "0");
                        setFollowDate(`${y}-${m}-${day}`);
                        setFollowTime("18:00");
                      }}
                    >
                      {t("crmPanel.todayAt", { time: "18:00" })}
                    </Button>
                    <Button
                      variant="secondary"
                      className="!min-h-7 !px-2 text-2xs"
                      onClick={() => {
                        const d = new Date();
                        d.setDate(d.getDate() + 1);
                        const y = d.getFullYear();
                        const m = String(d.getMonth() + 1).padStart(2, "0");
                        const day = String(d.getDate()).padStart(2, "0");
                        setFollowDate(`${y}-${m}-${day}`);
                        setFollowTime("10:00");
                      }}
                    >
                      {t("crmPanel.tomorrowAt", { time: "10:00" })}
                    </Button>
                    <Button
                      variant="secondary"
                      className="!min-h-7 !px-2 text-2xs"
                      onClick={() => {
                        const d = new Date();
                        d.setDate(d.getDate() + 3);
                        const y = d.getFullYear();
                        const m = String(d.getMonth() + 1).padStart(2, "0");
                        const day = String(d.getDate()).padStart(2, "0");
                        setFollowDate(`${y}-${m}-${day}`);
                        setFollowTime("10:00");
                      }}
                    >
                      {t("crmPanel.inDays", { count: 3 })}
                    </Button>
                  </div>
                  <div className="flex justify-end gap-1.5">
                    <Button
                      variant="ghost"
                      className="!min-h-7 !px-2 text-2xs"
                      onClick={() => setFollowSchedulerOpen(false)}
                    >
                      {t("crm.cancel")}
                    </Button>
                    <Button
                      variant="secondary"
                      className="!min-h-7 gap-1 !px-2 text-2xs"
                      onClick={commitFollowSchedule}
                    >
                      <CalendarPlus className="h-3 w-3" />
                      {t("crmPanel.saveFollowUp")}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {openFollowUps[0] && (
                    <Button
                      variant="secondary"
                      className="!min-h-7 gap-1 !px-2 text-2xs"
                      onClick={() => toggleFollowUp(openFollowUps[0]!.id)}
                    >
                      <Check className="h-3 w-3" />
                      {t("crmPanel.complete")}
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    className="!min-h-7 gap-1 !px-2 text-2xs"
                    onClick={() => {
                      const result = scheduleTomorrowFollowUp(
                        contact.id,
                        `${workflow?.tomorrowNote || t("crmPanel.followUp")}${lastIn ? ` · ${lastIn.body.slice(0, 45)}` : ""}`
                      );
                      if (result) {
                        pushToast(
                          t("crmPanel.tomorrowSet", { due: formatFollowDue(result.dueAt) }),
                          "success"
                        );
                      }
                    }}
                  >
                    <CalendarPlus className="h-3 w-3" />
                    {openFollowUps[0] ? t("crmPanel.moveTomorrow") : t("crmPanel.tomorrowAt", { time: "10:00" })}
                  </Button>
                  <Button
                    variant="secondary"
                    className="!min-h-7 gap-1 !px-2 text-2xs"
                    onClick={openFollowScheduler}
                  >
                    {t("crmPanel.chooseDateTime")}
                  </Button>
                </div>
              )}
            </div>

            <GoogleSheetInfo contact={contact} chatId={selectedChatId} expanded={sheetInfoOpen} onExpandedChange={setSheetInfoOpen} />

            <details open={moreDetailsOpen} onToggle={event => setMoreDetailsOpen(event.currentTarget.open)} className="py-1">
              <summary className="cursor-pointer py-1 text-xs text-zinc-500 hover:text-zinc-300">{t("crmPanel.moreDetails")}</summary>
              <div className="mt-2 space-y-2">
            <PersonMultiAccountPanel
              variant="card"
              seed={contact}
              contacts={contacts}
              chats={chats}
              selectedContactId={selectedContactId}
              selectedChatId={selectedChatId}
              focusAccountId={
                threadAccountId ||
                contact?.accountId ||
                settings.liveBaileysAccountId ||
                settings.activeAccountId
              }
              waAccounts={settings.waAccounts}
              liveBaileysAccountId={settings.liveBaileysAccountId}
              liveConnection={baileysUi.connection}
              onOpenThread={(row) => {
                const exists = chats.some((c) => c.id === row.chatId);
                if (exists) {
                  setSelectedChat(row.chatId, row.accountId);
                } else {
                  openContactWorkspace(row.contactId);
                  const openedChatId = useAppStore.getState().selectedChatId;
                  if (openedChatId) setSelectedChat(openedChatId, row.accountId);
                }
              }}
            />

            {!contact.isGroup && (
              <CommonGroupsPanel
                contact={contact}
                accountId={
                  threadAccountId ||
                  contact.accountId ||
                  settings.liveBaileysAccountId ||
                  settings.activeAccountId
                }
                connected={isBaileys && labelAccountConnected}
                onOpenGroup={(group) => {
                  const groupContact = contacts.find(
                    (candidate) =>
                      candidate.isGroup &&
                      (candidate.channelAddress === group.jid ||
                        candidate.id === group.jid ||
                        candidate.phone === group.jid)
                  );
                  const groupChat = chats.find(
                    (chat) =>
                      (groupContact && chat.contactId === groupContact.id) ||
                      chat.id === `bridge-chat-${group.jid}`
                  );
                  if (!groupChat) {
                    pushToast(t("crmPanel.groupNotSynced"), "info");
                    return;
                  }
                  setSelectedChat(groupChat.id, groupChat.accountId || aiAccountId);
                  setActiveNav("chats");
                }}
              />
            )}

              </div>
            </details>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-2.5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <SectionLabel className="!mb-0">{t("crmPanel.tags")}</SectionLabel>
                <div className="flex items-center gap-1.5">
                  {isBaileys && (
                    <WhatsAppLabelMenu
                      labels={whatsappLabels}
                      activeNames={contact.tags}
                      disabled={!labelAccountConnected}
                      onToggle={toggleLabel}
                      onCreate={createLabel}
                    />
                  )}
                  <button
                    type="button"
                    className="text-[10px] text-brand hover:underline"
                    onClick={() => setTagsOpen((value) => !value)}
                  >
                    {tagsOpen ? t("crmPanel.collapseText") : t("crmPanel.edit")}
                  </button>
                </div>
              </div>
              {tagsOpen ? (
                <ContactTagsNotesEditor contact={contact} compact mode="tags" />
              ) : (
                <div className="flex min-h-[2rem] flex-wrap content-start gap-1">
                  {contact.tags.length ? (
                    contact.tags.slice(0, 10).map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] text-brand"
                      >
                        {tag}
                      </span>
                    ))
                  ) : (
                    <button
                      type="button"
                      onClick={() => setTagsOpen(true)}
                      className="text-[10px] text-zinc-600 hover:text-brand"
                    >
                      {t("crmPanel.noTags")}
                    </button>
                  )}
                </div>
              )}
            </div>

          </div>
        )}
      </section>

      <section className="flex max-h-[45%] min-h-0 shrink-0 flex-col border-t border-zinc-800/90 p-2.5">
        <div className="flex items-center gap-2">
          <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-semibold" aria-expanded={suggestionsOpen} aria-controls="crm-reply-suggestion" onClick={()=>setSuggestionExpansion({key:expansionKey,open:!suggestionsOpen})}>
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-brand" />{t("crmPanel.replySuggestions")}
            <ChevronDown className={cn("h-3 w-3 text-zinc-500 transition-transform",suggestionsOpen&&"rotate-180")} />
          </button>
          {loading&&<span role="status" className="flex shrink-0 items-center gap-1 text-[10px] text-zinc-500"><Loader2 className="h-3 w-3 animate-spin" />{t("crmPanel.generating")}</span>}
          {aiReady?<Button variant="ghost" size="xs" className="shrink-0 gap-1 !px-1.5" aria-label={loading?t("crmPanel.generating"):aiSuggestions.length?t("crmPanel.regenerate"):t("crmPanel.generateReply")} disabled={loading} onClick={()=>void refreshAi()}>
            {!loading&&<RefreshCw className="h-3 w-3" />}{t(aiSuggestions.length?"crmPanel.regenerate":"crmPanel.generateReply")}
          </Button>:<Button variant="ghost" size="xs" onClick={()=>setSettingsOpen(true,"ai")}>{t("crmPanel.configureApi")}</Button>}
          {contact&&selectedChatId&&<Button variant="ghost" size="xs" className="shrink-0 !px-1.5" title="整理聊天到 Google 表格" aria-label="整理聊天到 Google 表格" onClick={()=>setSheetExtractOpen(true)}><TableProperties className="h-3.5 w-3.5" /></Button>}
        </div>
        {suggestionsOpen&&<div id="crm-reply-suggestion" className="min-h-0 overflow-y-auto">
          {!aiReady?<p className="mt-1 text-[11px] text-zinc-500">{t("crmPanel.noAi")}</p>:<>
            {settings.aiProvider==="muse"&&<MuseQueueStatus/>}
            {!loading&&aiError&&<p role="alert" className="mt-2 rounded-lg bg-amber-500/10 p-2 text-[11px] text-amber-500">{aiError}</p>}
            {aiSuggestions.length>0&&<>
              <div className="my-1.5 flex items-center justify-between gap-2">
                <AiSuggestionReadingControl language={readingLanguage} targetLanguage={readingTarget||resolveMyLang(settings)} onChange={language=>{if(language)setReadingTarget(language);setReadingLanguage(language);}} />
                {aiSource==="mock"&&<span className="text-[10px] text-amber-500">{t("crmPanel.exampleReply")}</span>}
              </div>
              {aiSuggestions.slice(0,1).map(suggestion=><AiSuggestionCard
                key={JSON.stringify([selectedChatId,aiAccountId,suggestionKey,suggestion.text])}
                text={suggestion.text} contextKey={suggestionKey} settings={settings} language={readingLanguage}
                  onInsert={(mode,editedText=suggestion.text) => {
                    const current = useAppStore.getState();
                    const currentContact = current.contacts.find(item => item.id === current.selectedContactId);
                    const accountId = (current.selectedThreadAccount?.chatId === current.selectedChatId ? current.selectedThreadAccount.accountId : null)
                      || current.chats.find(chat => chat.id === current.selectedChatId)?.accountId
                      || currentContact?.accountId;
                    if (current.selectedChatId !== selectedChatId || current.selectedContactId !== selectedContactId
                      || accountId !== aiAccountId || latestSuggestionKey.current !== suggestionKey
                      || !current.aiSuggestions.some(item => item.id === suggestion.id && item.text === suggestion.text)) return;
                    const currentThread = filterMessagesForAccount(threadForContact(current.messagesByChatId[selectedChatId || ""] || [], selectedContactId, selectedChatId),
                      current.selectedThreadAccount?.chatId === selectedChatId ? current.selectedThreadAccount.accountId : null,
                      current.settings.liveBaileysAccountId);
                    if (getSuggestionContextKey(currentContact, currentThread, current.settings, accountId, { chatId: selectedChatId || undefined,count:1 }) !== suggestionKey) return;
                    const visibleExpiry = visibleSuggestionExpiry.current;
                    if (!suggestionCache.get(suggestionKey) && (visibleExpiry?.key !== suggestionKey || Date.now() >= visibleExpiry.expiresAt)) {
                      useAppStore.setState({ aiSuggestions: [] });
                      setAiError(t("crmPanel.suggestionsExpired"));
                      return;
                    }
                    if(!editedText.trim())return;
                    applyAiSuggestion(editedText, mode);
                    pushToast(t(mode === "append" ? "crmPanel.append" : "crmPanel.fillInput"), mode === "append" ? "info" : "success");
                  }}
              />)}
              <details className="mt-1 text-[10px] text-zinc-500"><summary className="cursor-pointer">{t("crmPanel.suggestionDetails")}</summary>
                <p className="mt-1 break-words">{t("crmPanel.source",{source:aiSource==="mock"?t("crmPanel.exampleReply"):aiSource,count:thread.length})}</p>
                <p>{t(aiProfile.source==="folder"?"folderAi.source.folder":aiProfile.source==="account"?"folderAi.source.account":aiProfile.source==="global"?"folderAi.source.global":"folderAi.source.default",{name:aiProfile.folderName||""})}</p>
              </details>
            </>}
          </>}
        </div>}
      </section>
        </>
      ) : (
        <section className="flex min-h-0 flex-1 flex-col">
          <QuickReplyBrowser
            onManage={() => setSettingsOpen(true, "quick-replies")}
            replies={settings.quickReplies || []}
            categories={settings.quickReplyCustomCategories || []}
            removedCategories={settings.quickReplyRemovedCategories}
            categoryLabels={settings.quickReplyCategoryLabels} categoryOrder={settings.quickReplyCategoryOrder}
            contextKey={["main", selectedChatId, quickReplyAccountId, settings.sendChannel, quickReplyChat?.phoneId].join(":")}
            target={quickReplyChat ? { title: quickReplyChat.contactName || contact?.name || quickReplyChat.id, account: quickReplyIdentity } : undefined}
            pinnedIds={settings.quickReplyPinnedIds}
            recentIds={settings.quickReplyRecentIds}
            onTogglePin={toggleQuickReplyPin}
            onUsed={recordQuickReplyUsage}
            disabled={!quickReplyChat}
            onInsert={reply => {
              if (!selectedChatId || useAppStore.getState().selectedChatId !== selectedChatId) return false;
              if (reply.media) {
                const accepted = emitQuickReplyMedia({ ...reply.media, caption: reply.body,
                  token: reply.id + "-" + Date.now(), target: "main", chatId: selectedChatId });
                if (!accepted) { pushToast(t("quickShelf.insertUnavailable"), "info"); return false; }
              } else if (reply.body.trim()) applyAiSuggestion(reply.body, "append");
              pushToast(t(reply.media ? "quickShelf.mediaInserted" : "crmPanel.appended"), "success");
            }}
          />
        </section>
      )}
      {sheetExtractOpen&&contact&&<AiSheetExtractDialog contact={contact} messages={thread} accountId={aiAccountId} settings={settings} onClose={()=>setSheetExtractOpen(false)} onWritten={()=>pushToast("已写入 Google 表格","success")} />}
    </aside>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md bg-zinc-900/70 px-2 py-1.5">
      <div className="text-[9px] text-zinc-500">{label}</div>
      <div className="truncate text-[11px] text-zinc-200">{value}</div>
    </div>
  );
}
