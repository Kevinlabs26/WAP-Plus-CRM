import {
  CalendarPlus,
  Check,
  Copy,
  ExternalLink,
  PanelRightClose,
  RefreshCw,
  Search,
  ShoppingCart,
  Sparkles,
  Zap,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "@/store/appStore";
import { cn, displayContactLabel, displayPhone, resolveSendTarget } from "@/lib/utils";
import {
  baileysCreateLabel,
  baileysLabels,
  baileysSetChatLabel,
} from "@/lib/baileys";
import { generateSuggestions, hasRealAiKey, type SuggestResult } from "@/lib/aiSuggest";
import type { Message, SalesStage, WhatsAppLabel } from "@/types/crm";
import { Avatar } from "@/components/ui/Avatar";
import { Button, SectionLabel } from "@/components/ui/primitives";
import { ContactTagsNotesEditor } from "./ContactTagsNotesEditor";
import { PersonMultiAccountPanel } from "./PersonMultiAccountPanel";
import { CommonGroupsPanel } from "./CommonGroupsPanel";
import { CustomerNoteEditor } from "./CustomerNoteEditor";
import { WhatsAppLabelMenu } from "@/components/chat/WhatsAppLabelMenu";
import { SALES_STAGES, workflowForStage } from "@/lib/contactWorkflow";
import { filterMessagesForAccount } from "@/lib/personThreads";
import { isWaAccountConnected } from "@/lib/accountConnection";
import {
  filterQuickReplies,
  QUICK_REPLY_CATEGORIES,
  type QuickReplyCategoryFilter,
} from "@/lib/quickReplies";
import { useI18n } from "@/i18n";

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
  const messagesByChatId = useAppStore((state) => state.messagesByChatId);
  const followUps = useAppStore((state) => state.followUps);
  const selectedContactId = useAppStore((state) => state.selectedContactId);
  const selectedChatId = useAppStore((state) => state.selectedChatId);
  const selectedThreadAccount = useAppStore(
    (state) => state.selectedThreadAccount
  );
  const chats = useAppStore((state) => state.chats);
  const openContactWorkspace = useAppStore(
    (state) => state.openContactWorkspace
  );
  const setSelectedChat = useAppStore((state) => state.setSelectedChat);
  const aiSuggestions = useAppStore((state) => state.aiSuggestions);
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);
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
  const setSelectedContact = useAppStore((state) => state.setSelectedContact);
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
  const [followSchedulerOpen, setFollowSchedulerOpen] = useState(false);
  const [followDate, setFollowDate] = useState("");
  const [followTime, setFollowTime] = useState("10:00");
  const [followNote, setFollowNote] = useState("");
  const [quickQuery, setQuickQuery] = useState("");
  const [quickCategory, setQuickCategory] =
    useState<QuickReplyCategoryFilter>("all");
  const [loading, setLoading] = useState(false);
  const [aiSource, setAiSource] = useState<string>(settings.aiProvider);
  const autoKey = useRef("");
  const suggestionCache = useRef(
    new Map<string, { suggestions: SuggestResult[]; source: string }>()
  );

  const contact = contacts.find((item) => item.id === selectedContactId);
  const threadAccountId =
    selectedThreadAccount?.chatId === selectedChatId
      ? selectedThreadAccount.accountId
      : null;
  const aiAccountId =
    threadAccountId ||
    chats.find((chat) => chat.id === selectedChatId)?.accountId ||
    contact?.accountId;
  const thread = useMemo(() => {
    if (collapsed) return [];
    // 用 messagesByChatId 索引桶（已按 chatId 分组 + sentAt 排序），避免全量扫 messages
    const bucket = selectedChatId
      ? messagesByChatId[selectedChatId]
      : undefined;
    if (!bucket?.length) return [];
    return filterMessagesForAccount(
      threadForContact(bucket, selectedContactId, selectedChatId),
      threadAccountId,
      settings.liveBaileysAccountId
    );
  }, [
    collapsed,
    messagesByChatId,
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
  const manualOnly = Boolean(
    selectedChatId && settings.aiAutoReplyManualChatIds.includes(selectedChatId)
  );
  const filteredQuickReplies = useMemo(
    () =>
      filterQuickReplies(
        settings.quickReplies || [],
        quickCategory,
        quickQuery
      ),
    [settings.quickReplies, quickCategory, quickQuery]
  );
  const availableQuickCategories = useMemo(
    () =>
      QUICK_REPLY_CATEGORIES.filter((category) =>
        settings.quickReplies?.some((reply) => reply.category === category.id)
      ),
    [settings.quickReplies]
  );

  const makeSuggestionKey = () =>
    [
      selectedChatId || "",
      contact?.id || "",
      aiAccountId || "default",
      settings.aiProvider,
      settings.aiModel,
      settings.aiSystemPrompt,
      settings.aiSystemPromptByAccountId?.[aiAccountId || ""] || "",
      lastIn?.id || "none",
    ].join("\u001f");

  const rememberSuggestions = (result: {
    suggestions: SuggestResult[];
    source: string;
    fallback?: boolean;
  }) => {
    if (result.fallback) return;
    const key = makeSuggestionKey();
    suggestionCache.current.set(key, {
      suggestions: result.suggestions,
      source: result.source,
    });
    while (suggestionCache.current.size > 24) {
      const oldest = suggestionCache.current.keys().next().value;
      if (!oldest) break;
      suggestionCache.current.delete(oldest);
    }
  };

  useEffect(() => {
    if (
      quickCategory !== "all" &&
      !availableQuickCategories.some((category) => category.id === quickCategory)
    ) {
      setQuickCategory("all");
    }
  }, [availableQuickCategories, quickCategory]);

  const setManualOnly = (enabled: boolean) => {
    if (!selectedChatId) return;
    const current = settings.aiAutoReplyManualChatIds;
    updateSettings({
      aiAutoReplyManualChatIds: enabled
        ? [...new Set([...current, selectedChatId])]
        : current.filter((id) => id !== selectedChatId),
    });
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
    autoKey.current = "";
    useAppStore.setState({ aiSuggestions: [] });
  }, [selectedChatId, selectedContactId]);

  const refreshAi = async () => {
    if (!contact) return pushToast("\u8bf7\u5148\u9009\u62e9\u4f1a\u8bdd", "info");
    if (!aiReady) {
      useAppStore.setState({ aiSuggestions: [] });
      setAiSource("unconfigured");
      return;
    }
    setLoading(true);
    try {
      const result = await generateSuggestions(contact, thread, settings, {
        accountId: aiAccountId,
      });
      useAppStore.setState({ aiSuggestions: result.suggestions });
      setAiSource(result.source === "mock" ? settings.aiProvider : result.source);
      rememberSuggestions(result);
      pushToast(
        result.fallback ? "API \u4e0d\u53ef\u7528 \u00b7 \u5df2\u7528\u672c\u5730\u5efa\u8bae" : "\u5df2\u751f\u6210\u56de\u590d\u5efa\u8bae",
        result.fallback ? "info" : "success"
      );
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "\u751f\u6210\u5efa\u8bae\u5931\u8d25", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (collapsed || !contact || !thread.length || !aiReady) return;
    const key = makeSuggestionKey();
    if (autoKey.current === key) return;
    autoKey.current = key;
    const cached = suggestionCache.current.get(key);
    if (cached) {
      useAppStore.setState({ aiSuggestions: cached.suggestions });
      setAiSource(cached.source === "mock" ? settings.aiProvider : cached.source);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void generateSuggestions(contact, thread, settings, {
        accountId: aiAccountId,
      })
        .then((result) => {
          if (cancelled) return;
          useAppStore.setState({ aiSuggestions: result.suggestions });
          setAiSource(result.source === "mock" ? settings.aiProvider : result.source);
          rememberSuggestions(result);
          setLoading(false);
        })
        .catch(() => {
          if (!cancelled) setLoading(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      setLoading(false);
    };
    // Only refresh when the conversation changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    collapsed,
    selectedChatId,
    contact?.id,
    aiAccountId,
    lastIn?.id,
    aiReady,
    settings.aiProvider,
    settings.aiModel,
    settings.aiSystemPrompt,
    settings.aiSystemPromptByAccountId,
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
        className="grid grid-cols-2 gap-1 border-b border-zinc-800/90 p-1.5"
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
      </div>

      {panelTab === "customer" ? (
        <>
      <section className="min-h-0 flex-1 overflow-y-auto p-3">
        {!contact ? (
          <p className="py-8 text-center text-2xs text-zinc-600">{t("crmPanel.selectChat")}</p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-start gap-2.5">
              <Avatar
                name={displayContactLabel(
                  contact.name,
                  contact.phone,
                  contact.channelAddress,
                  lastIn?.body,
                  { isGroup: !!contact.isGroup }
                )}
                seed={contact.phone || contact.id}
                src={contact.avatarUrl}
                size="lg"
              />
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
                <button
                  type="button"
                  onClick={() => {
                    if (contact) setSelectedContact(contact.id);
                    setActiveNav("crm");
                  }}
                  className="mt-1 inline-flex items-center gap-1 text-[10px] text-brand hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  {t("crmPanel.fullDetails")}
                </button>
              </div>
            </div>

            {meta.length > 0 && (
              <div className={cn("grid gap-1.5", meta.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
                {meta.map(([label, value]) => <Meta key={label} label={label} value={value} />)}
              </div>
            )}

            <label className="block text-2xs text-zinc-500">
              {t("crmPanel.salesStage")}
              <select
                value={contact.stage}
                onChange={(event) => updateContact(contact.id, { stage: event.target.value as SalesStage })}
                className="ui-control mt-1 h-8 w-full px-2 text-[12px]"
              >
                {SALES_STAGES.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
              </select>
            </label>

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

            <CustomerNoteEditor
              contact={contact}
              chatId={selectedChatId}
              compact
            />
          </div>
        )}
      </section>

      <section className={cn("flex flex-col border-t border-zinc-800/90 p-3", (loading || aiSuggestions.length) && "max-h-[38%] min-h-48")}>
          <div className={cn("flex flex-wrap items-center gap-1.5", (loading || aiSuggestions.length) && "mb-2")}>
          <div className="shrink-0 whitespace-nowrap flex items-center gap-1.5 text-[13px] font-semibold">
            <Sparkles className="h-3.5 w-3.5 text-brand" />
            {t("crmPanel.replySuggestions")}
          </div>
          {selectedChatId && (
            <label className="shrink-0 flex items-center gap-1 text-[10px] text-zinc-500">
              {t("crmPanel.autoMode")}
              <select
                value={manualOnly ? "manual" : "auto"}
                onChange={(event) => setManualOnly(event.target.value === "manual")}
                className="ui-control h-7 px-1.5 text-[10px]"
                title={t("crmPanel.manualTitle")}
              >
                <option value="auto">{t("crmPanel.followGlobal")}</option>
                <option value="manual">{t("crmPanel.manualOnly")}</option>
              </select>
            </label>
          )}
          {aiReady && (
            <Button variant="ghost" className="shrink-0 !min-h-7 gap-1 !px-2 text-2xs" disabled={loading} onClick={() => void refreshAi()}>
              <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
              {loading ? t("crmPanel.generating") : aiSuggestions.length ? t("crmPanel.regenerate") : t("crmPanel.generateReply")}
            </Button>
          )}
        </div>
        {!aiReady ? (
          <div className="flex min-h-36 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
            <p className="text-[12px] font-medium text-zinc-300">
              {t("crmPanel.noAi")}
            </p>
            <p className="text-2xs leading-4 text-zinc-500">
              {t("crmPanel.noAiHint")}
            </p>
            <Button variant="secondary" className="!min-h-8 gap-1.5 !px-3 text-2xs" onClick={() => setSettingsOpen(true, "ai")}>
              <Sparkles className="h-3 w-3" />
              {t("crmPanel.configureApi")}
            </Button>
          </div>
        ) : (
          <>
            {!loading && aiSuggestions.length > 0 && (
              <p className="mb-1.5 break-words text-[10px] leading-3 text-zinc-600">{t("crmPanel.suggestionHint")}</p>
            )}
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
              {!loading && aiSuggestions.map((suggestion) => (
                <div
                  key={suggestion.id}
                  className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5 transition-colors hover:border-brand/30 hover:bg-zinc-900"
                >
                  <p className="line-clamp-3 text-[11px] leading-4 text-zinc-300">{suggestion.text}</p>
                  <div className="mt-2 flex items-center gap-1.5">
                    <button
                      type="button"
                      className="rounded-md bg-brand/15 px-2 py-1 text-[10px] font-medium text-brand hover:bg-brand/25"
                      onClick={() => {
                        applyAiSuggestion(suggestion.text, "replace");
                        pushToast(t("crmPanel.fillInput"), "success");
                      }}
                    >
                      {t("crmPanel.fillInput")}
                    </button>
                    <button
                      type="button"
                      className="rounded-md px-2 py-1 text-[10px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                      onClick={() => {
                        applyAiSuggestion(suggestion.text, "append");
                        pushToast(t("crmPanel.append"), "info");
                      }}
                    >
                      {t("crmPanel.append")}
                    </button>
                  </div>
                </div>
              ))}
              {loading && <div className="py-6 text-center text-2xs text-zinc-500">{t("crmPanel.generating")}…</div>}
            </div>
            {(loading || aiSuggestions.length > 0) && <p className="mt-1.5 break-words text-[9px] text-zinc-600">{t("crmPanel.source", { source: aiSource, count: thread.length })}</p>}
          </>
        )}
      </section>
        </>
      ) : (
        <section className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-zinc-800/90 px-3 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                <Zap className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="text-[12px] font-medium text-zinc-100">
                  {t("crmPanel.commonReplies")}
                </div>
                <div className="text-2xs text-zinc-500">
                  {t("crmPanel.quickCount", { shown: filteredQuickReplies.length, total: settings.quickReplies?.length || 0 })}
                </div>
              </div>
            </div>
            <Button
              variant="ghost"
              size="xs"
              className="shrink-0 text-zinc-400"
              onClick={() => setSettingsOpen(true, "quick-replies")}
            >
              {t("crmPanel.manage")}
            </Button>
          </div>

          {(settings.quickReplies || []).length > 0 && (
            <div className="space-y-2 border-b border-zinc-800/90 p-2.5">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
                <input
                  value={quickQuery}
                  onChange={(event) => setQuickQuery(event.target.value)}
                  placeholder={t("crmPanel.searchReplies")}
                  aria-label={t("crmPanel.quickReplies")}
                  className="ui-control h-8 w-full pl-8 pr-2 text-[11px]"
                />
              </label>
              {availableQuickCategories.length > 1 && (
                <div className="flex gap-1 overflow-x-auto" aria-label={t("crmPanel.replyCategories")}>
                  <button
                    type="button"
                    aria-pressed={quickCategory === "all"}
                    className={cn(
                      "shrink-0 rounded-full px-2.5 py-1 text-[10px]",
                      quickCategory === "all"
                        ? "bg-brand/15 text-brand"
                        : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
                    )}
                    onClick={() => setQuickCategory("all")}
                  >
                    {t("starred.all")}
                  </button>
                  {availableQuickCategories.map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      aria-pressed={quickCategory === category.id}
                      className={cn(
                        "shrink-0 rounded-full px-2.5 py-1 text-[10px]",
                        quickCategory === category.id
                          ? "bg-brand/15 text-brand"
                          : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
                      )}
                      onClick={() => setQuickCategory(category.id)}
                    >
                      {category.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {(settings.quickReplies || []).length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
              <Zap className="h-8 w-8 text-zinc-600" />
              <div>
                <p className="text-[12px] text-zinc-400">{t("crmPanel.noReplies")}</p>
                <p className="mt-1 text-2xs text-zinc-600">
                  {t("crmPanel.noRepliesHint")}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setSettingsOpen(true, "quick-replies")}
              >
                {t("crmPanel.addReply")}
              </Button>
            </div>
          ) : (
            <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
              {filteredQuickReplies.map((reply) => (
                <li key={reply.id}>
                  <button
                    type="button"
                    disabled={!reply.body.trim()}
                    className="flex w-full flex-col gap-1 rounded-xl px-3 py-3 text-left transition-colors hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => {
                      applyAiSuggestion(reply.body, "append");
                      pushToast(t("crmPanel.appended"), "success");
                    }}
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="truncate text-[12px] font-medium text-zinc-100">
                        {reply.title || t("crmPanel.unnamed")}
                      </span>
                      <span className="shrink-0 rounded-full bg-zinc-800 px-2 py-0.5 text-[9px] text-zinc-500">
                        {QUICK_REPLY_CATEGORIES.find(
                          (category) => category.id === reply.category
                        )?.label || t("crmPanel.unnamed")}
                      </span>
                    </span>
                    <span className="line-clamp-3 text-[11px] leading-relaxed text-zinc-500">
                      {reply.body || t("crmPanel.noContent")}
                    </span>
                  </button>
                </li>
              ))}
              {filteredQuickReplies.length === 0 && (
                <li className="px-4 py-10 text-center text-[11px] text-zinc-600">
                  {t("crmPanel.noMatchingReplies")}
                </li>
              )}
            </ul>
          )}
        </section>
      )}
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
