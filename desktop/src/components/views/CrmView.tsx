import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import {
  ChevronLeft,
  ChevronRight,
  CheckSquare,
  Plus,
  Search,
  LayoutGrid,
  List,
  Clock3,
  CalendarDays,
  Megaphone,
  Tag,
  X,
  Download,
  FilePlus2,
  Trash2,
} from "lucide-react";
import { useAppStore } from "@/store/appStore";
import type { Contact, SalesStage } from "@/types/crm";
import { cn, displayPhone } from "@/lib/utils";
import {
  contactTitle,
  insightLine,
  needsDisplayName,
} from "./crmCardHelpers";
import { CrmBoardCard } from "./CrmBoardCard";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  ListRow,
} from "@/components/ui/primitives";
import { Avatar } from "@/components/ui/Avatar";
import { AddContactForm } from "@/components/crm/AddContactForm";
import { ContactEditor } from "@/components/crm/ContactEditor";
import { ContactImportModal } from "@/components/settings/ContactImportModal";
import {
  SALES_STAGES as DEFAULT_STAGES,
  salesStagesWithLabels,
} from "@/lib/contactWorkflow";
import {
  BROADCAST_DRAFT_CONTACT_IDS_KEY,
  BROADCAST_DRAFT_ACCOUNT_ID_KEY,
  contactSendablePhone,
} from "@/lib/broadcastTemplate";
import { contactsToCsv, downloadText } from "@/lib/exportData";
import { BROADCAST_HARD_CAP } from "@/types/broadcast";
import { useI18n } from "@/i18n";

type CrmMode = "board" | "list";
type CrmQuickFilter =
  | "active"
  | "all"
  | "needs_name"
  | "due_followup"
  | "has_note";
const CRM_MODE_KEY = "wap.crmMode";
const CRM_FILTER_KEY = "wap.crmQuickFilter";

/** CRM 只经营 1:1 联系人，群聊留在会话页 */
function isPersonContact(c: Contact): boolean {
  if (c.isGroup) return false;
  const addr = (c.channelAddress || "").toLowerCase();
  if (addr.includes("@g.us")) return false;
  return true;
}

function localDayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayKeyAfter(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localDayKey(date);
}

export function CrmView() {
  const { t } = useI18n();
  const contacts = useAppStore((s) => s.contacts);
  const chats = useAppStore((s) => s.chats);
  const phones = useAppStore((s) => s.phones);
  const followUps = useAppStore((s) => s.followUps);
  const salesStageLabels = useAppStore((s) => s.settings.salesStageLabels || {});
  const salesStageOrder = useAppStore((s) => s.settings.salesStageOrder || []);
  const selectedContactId = useAppStore((s) => s.selectedContactId);
  const setSelectedContact = useAppStore((s) => s.setSelectedContact);
  const updateContact = useAppStore((s) => s.updateContact);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const addContact = useAppStore((s) => s.addContact);
  const openContactWorkspace = useAppStore((s) => s.openContactWorkspace);
  const setActiveNav = useAppStore((s) => s.setActiveNav);
  const scheduleTomorrowFollowUp = useAppStore(
    (s) => s.scheduleTomorrowFollowUp
  );
  const scheduleFollowUp = useAppStore((s) => s.scheduleFollowUp);
  const scheduleFollowUps = useAppStore((s) => s.scheduleFollowUps);
  const pushToast = useAppStore((s) => s.pushToast);
  const batchUpdateContacts = useAppStore((s) => s.batchUpdateContacts);
  const requestConfirm = useAppStore((s) => s.requestConfirm);

  const [q, setQ] = useState("");
  const deferredQ = useDeferredValue(q);
  const [mode, setMode] = useState<CrmMode>(() => {
    try {
      return localStorage.getItem(CRM_MODE_KEY) === "list" ? "list" : "board";
    } catch {
      return "board";
    }
  });
  const [quickFilter, setQuickFilter] = useState<CrmQuickFilter>(() => {
    try {
      const saved = localStorage.getItem(CRM_FILTER_KEY);
      if (
        saved === "all" ||
        saved === "needs_name" ||
        saved === "due_followup" ||
        saved === "has_note"
      ) return saved;
    } catch {
      /* ignore */
    }
    return "active";
  });
  const [showAdd, setShowAdd] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [addingStage, setAddingStage] = useState(false);
  const [newStageName, setNewStageName] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);
  /** 聊天右上角「客户资料」跳转进来的一次性定位目标 */
  const [crmFocusId, setCrmFocusId] = useState<string | null>(null);
  const listVirtuosoRef = useRef<VirtuosoHandle | null>(null);
  const [editingStageId, setEditingStageId] = useState<SalesStage | null>(null);
  const [stageNameDraft, setStageNameDraft] = useState("");
  const [dragOverStage, setDragOverStage] = useState<SalesStage | null>(null);
  /** 多选批量操作模式 */
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkTagDraft, setBulkTagDraft] = useState("");
  const [bulkFollowUpDate, setBulkFollowUpDate] = useState(() => dayKeyAfter(1));
  /**
   * 看板拖放：HTML5 DnD 在 WebView 里 drop 常被拦（禁止图标），
   * 改用 pointer 事件自实现，鼠标/触控都稳。
   */
  const [pointerDrag, setPointerDrag] = useState<{
    contactId: string;
    x: number;
    y: number;
    active: boolean;
  } | null>(null);
  const pointerDragRef = useRef(pointerDrag);
  pointerDragRef.current = pointerDrag;
  const wasDraggingRef = useRef(false);
  const stageColRefs = useRef<Partial<Record<SalesStage, HTMLDivElement | null>>>({});

  const stageAtPoint = (x: number, y: number): SalesStage | null => {
    for (const [stageId, el] of Object.entries(stageColRefs.current)) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return stageId;
      }
    }
    return null;
  };

  useEffect(() => {
    if (!pointerDrag) return;
    const onMove = (e: PointerEvent) => {
      const cur = pointerDragRef.current;
      if (!cur) return;
      const dx = e.clientX - cur.x;
      const dy = e.clientY - cur.y;
      if (!cur.active && Math.hypot(dx, dy) < 6) return;
      if (!cur.active) {
        setPointerDrag((p) => (p ? { ...p, active: true } : p));
      }
      setDragOverStage(stageAtPoint(e.clientX, e.clientY));
      e.preventDefault();
    };
    const onUp = (e: PointerEvent) => {
      const cur = pointerDragRef.current;
      if (!cur) return;
      setPointerDrag(null);
      setDragOverStage(null);
      if (cur.active) {
        wasDraggingRef.current = true;
        const target = stageAtPoint(e.clientX, e.clientY);
        if (target) moveContactToStage(cur.contactId, target);
        window.setTimeout(() => {
          wasDraggingRef.current = false;
        }, 0);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointerDrag]);

  const startCardDrag = useCallback((e: React.PointerEvent, contactId: string) => {
    if (e.button !== 0) return;
    setPointerDrag({ contactId, x: e.clientX, y: e.clientY, active: false });
  }, []);

  const stages = useMemo(
    () => salesStagesWithLabels(salesStageLabels, salesStageOrder),
    [salesStageLabels, salesStageOrder]
  );

  useEffect(() => {
    let stageId = "";
    try {
      stageId = localStorage.getItem("wap.crmStageFocus") || "";
      localStorage.removeItem("wap.crmStageFocus");
    } catch {
      /* ignore */
    }
    if (!stageId || !stages.some((stage) => stage.id === stageId)) return;
    const frame = requestAnimationFrame(() => {
      stageColRefs.current[stageId]?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [stages]);

  // 从聊天「客户资料」跳转：一次性消费，定位该客户并打开详情。
  // 不做会落到默认 quickFilter=active + 看板详情收起 → 「跳过来一片空白」。
  useEffect(() => {
    const focusId = useAppStore.getState().crmFocusContactId;
    if (!focusId) return;
    useAppStore.setState({ crmFocusContactId: null });
    setCrmFocusId(focusId);
    setSelectedContact(focusId);
    setQuickFilter("all");
    setDetailOpen(true);
  }, [setSelectedContact]);

  /** 客户页不展示群组 */
  const peopleContacts = useMemo(
    () => contacts.filter(isPersonContact),
    [contacts]
  );

  const dueContactIds = useMemo(() => {
    const today = localDayKey();
    const personIds = new Set(peopleContacts.map((c) => c.id));
    const ids = new Set<string>();
    for (const f of followUps) {
      if (f.done) continue;
      if (!personIds.has(f.contactId)) continue;
      const due = (f.dueAt || "").slice(0, 10);
      if (due && due <= today) ids.add(f.contactId);
    }
    return ids;
  }, [followUps, peopleContacts]);

  const unreadByContactId = useMemo(() => {
    const result = new Map<string, number>();
    for (const chat of chats) {
      if (!chat.contactId || !chat.unread) continue;
      result.set(chat.contactId, (result.get(chat.contactId) || 0) + chat.unread);
    }
    return result;
  }, [chats]);

  const filtered = useMemo(() => {
    const s = deferredQ.trim().toLowerCase();
    let list = peopleContacts;
    if (s) {
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(s) ||
          c.phone.includes(s) ||
          c.company?.toLowerCase().includes(s) ||
          c.notes?.toLowerCase().includes(s) ||
          c.tags.some((t) => t.toLowerCase().includes(s)) ||
          c.aiIntent?.toLowerCase().includes(s) ||
          c.aiNextStep?.toLowerCase().includes(s) ||
          c.aiSummary?.toLowerCase().includes(s)
      );
    }
    if (quickFilter === "active") {
      const recent = Date.now() - 30 * 24 * 60 * 60 * 1000;
      list = list.filter(
        (c) =>
          c.stage !== "new" ||
          dueContactIds.has(c.id) ||
          Boolean(c.tags.length || c.notes?.trim() || c.company?.trim()) ||
          Boolean(c.lastMessageAt && Date.parse(c.lastMessageAt) >= recent)
      );
    } else if (quickFilter === "needs_name") {
      list = list.filter(needsDisplayName);
    } else if (quickFilter === "due_followup") {
      list = list.filter((c) => dueContactIds.has(c.id));
    } else if (quickFilter === "has_note") {
      list = list.filter((c) => !!(c.notes || "").trim());
    }
    // 先处理到期与未读，再按最近活跃排序
    return [...list].sort((a, b) => {
      const dueA = dueContactIds.has(a.id) ? 1 : 0;
      const dueB = dueContactIds.has(b.id) ? 1 : 0;
      if (dueA !== dueB) return dueB - dueA;
      const unreadA = unreadByContactId.get(a.id) || 0;
      const unreadB = unreadByContactId.get(b.id) || 0;
      if (unreadA !== unreadB) return unreadB - unreadA;
      const ta = a.lastMessageAt || "";
      const tb = b.lastMessageAt || "";
      if (ta !== tb) return tb.localeCompare(ta);
      const na = needsDisplayName(a) ? 0 : 1;
      const nb = needsDisplayName(b) ? 0 : 1;
      if (na !== nb) return na - nb;
      return contactTitle(a).localeCompare(contactTitle(b), "zh");
    });
  }, [peopleContacts, deferredQ, quickFilter, dueContactIds, unreadByContactId]);

  const contact = peopleContacts.find((c) => c.id === selectedContactId);

  // 从聊天「客户资料」跳转：等 filtered 按「全部」重算后，滚动到该客户所在位置
  useEffect(() => {
    if (!crmFocusId) return;
    const frame = requestAnimationFrame(() => {
      const stageId = peopleContacts.find((c) => c.id === crmFocusId)?.stage;
      if (mode === "board") {
        if (stageId) {
          stageColRefs.current[stageId]?.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
            inline: "center",
          });
        }
      } else {
        const index = filtered.findIndex((c) => c.id === crmFocusId);
        if (index >= 0) listVirtuosoRef.current?.scrollToIndex({
          index,
          align: "center",
        });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [crmFocusId, mode, filtered, peopleContacts]);

  const byStage = useMemo(() => {
    const map = Object.fromEntries(
      stages.map((s) => [s.id, [] as Contact[]])
    ) as Record<SalesStage, Contact[]>;
    const fallback = stages[0]?.id || "new";
    for (const c of filtered) {
      (map[c.stage] ?? map[fallback]).push(c);
    }
    return map;
  }, [filtered, stages]);

  const filterCounts = useMemo(() => {
    let needsName = 0;
    let hasNote = 0;
    let active = 0;
    const recent = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const c of peopleContacts) {
      if (needsDisplayName(c)) needsName += 1;
      if ((c.notes || "").trim()) hasNote += 1;
      if (
        c.stage !== "new" ||
        dueContactIds.has(c.id) ||
        c.tags.length ||
        c.notes?.trim() ||
        c.company?.trim() ||
        (c.lastMessageAt && Date.parse(c.lastMessageAt) >= recent)
      ) {
        active += 1;
      }
    }
    return {
      active,
      needsName,
      dueFollowup: dueContactIds.size,
      hasNote,
    };
  }, [peopleContacts, dueContactIds]);

  const changeMode = (nextMode: CrmMode) => {
    setMode(nextMode);
    try {
      localStorage.setItem(CRM_MODE_KEY, nextMode);
    } catch {
      /* ignore */
    }
  };

  const changeQuickFilter = (nextFilter: CrmQuickFilter) => {
    setQuickFilter(nextFilter);
    try {
      localStorage.setItem(CRM_FILTER_KEY, nextFilter);
    } catch {
      /* ignore */
    }
  };

  const saveStageLabel = (stageId: SalesStage, raw: string) => {
    const label = raw.trim().slice(0, 20);
    const next = { ...(salesStageLabels || {}) };
    const def =
      DEFAULT_STAGES.find((s) => s.id === stageId)?.label || stageId;
    if (!label || label === def) delete next[stageId];
    else next[stageId] = label;
    updateSettings({ salesStageLabels: next });
    setEditingStageId(null);
    setStageNameDraft("");
    pushToast(
      label && label !== def
        ? t("crm.stageRenamed", { label })
        : t("crm.stageDefaultRestored", { label: def }),
      "success"
    );
  };

  const addStage = () => {
    const label = newStageName.trim().slice(0, 20);
    if (!label) return;
    const id = `stage_${Date.now().toString(36)}`;
    updateSettings({
      salesStageOrder: [...stages.map((stage) => stage.id), id],
      salesStageLabels: { ...salesStageLabels, [id]: label },
    });
    setAddingStage(false);
    setNewStageName("");
    pushToast(t("crm.stageAdded", { label }), "success");
  };

  const moveStage = (stageId: SalesStage, offset: -1 | 1) => {
    const order = stages.map((stage) => stage.id);
    const index = order.indexOf(stageId);
    const nextIndex = index + offset;
    if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return;
    [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
    updateSettings({ salesStageOrder: order });
  };

  const removeStage = async (stageId: SalesStage) => {
    if (DEFAULT_STAGES.some((stage) => stage.id === stageId)) {
      pushToast(t("crm.systemStageNoDelete"), "info");
      return;
    }
    const target = stages.find((stage) => stage.id !== stageId);
    if (!target) return;
    const ids = peopleContacts
      .filter((person) => person.stage === stageId)
      .map((person) => person.id);
    const ok = await requestConfirm({
      title: t("crm.deleteStageTitle", { stage: resolveStageLabel(stageId) }),
      description: ids.length
        ? t("crm.deleteStageWithContacts", { count: ids.length, stage: target.label })
        : t("crm.deleteStageEmpty"),
      confirmLabel: t("crm.deleteStage"),
      cancelLabel: t("common.cancel"),
      tone: "danger",
    });
    if (!ok) return;
    if (ids.length) batchUpdateContacts(ids, { stage: target.id });
    const labels = { ...salesStageLabels };
    delete labels[stageId];
    updateSettings({
      salesStageOrder: stages
        .map((stage) => stage.id)
        .filter((id) => id !== stageId),
      salesStageLabels: labels,
    });
    pushToast(t("crm.stageDeleted"), "success");
  };

  const resolveStageLabel = (stageId: SalesStage) =>
    stages.find((stage) => stage.id === stageId)?.label || stageId;

  const moveContactToStage = (contactId: string, stageId: SalesStage) => {
    const c = peopleContacts.find((x) => x.id === contactId);
    if (!c || c.stage === stageId) return;
    const label =
      stages.find((s) => s.id === stageId)?.label || stageId;
    updateContact(contactId, { stage: stageId });
    pushToast(
      t("crm.contactMoved", { stage: label, name: contactTitle(c) }),
      "success"
    );
  };

  const toggleSelect = useCallback((contactId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  }, []);
  const selectAllVisible = () => {
    setSelectedIds(new Set(filtered.map((c) => c.id)));
  };
  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };
  const applyBulkStage = (stageId: SalesStage) => {
    if (!selectedIds.size) return;
    const n = batchUpdateContacts(
      [...selectedIds],
      { stage: stageId },
      { activityTitle: "批量改阶段" }
    );
    pushToast(
      t("crm.contactsMoved", {
        count: n,
        stage: stages.find((s) => s.id === stageId)?.label || stageId,
      }),
      "success"
    );
    setSelectedIds(new Set());
  };
  const applyBulkTag = () => {
    const raw = bulkTagDraft.trim();
    if (!raw || !selectedIds.size) return;
    const tag = raw.replace(/^#+/, "").trim();
    if (!tag) return;
    const n = batchUpdateContacts(
      [...selectedIds],
      {},
      { activityTitle: "批量加标签", mergeTags: [tag] }
    );
    pushToast(t("crm.contactsTagged", { count: n, tag }), "success");
    setBulkTagDraft("");
  };
  const applyBulkFollowUp = () => {
    if (!selectedIds.size || !bulkFollowUpDate) return;
    const count = scheduleFollowUps([...selectedIds], bulkFollowUpDate);
    if (count) pushToast(t("crm.followUpsScheduled", { count }), "success");
  };
  const addSelectedToBroadcast = () => {
    const candidates = peopleContacts.filter(
      (contact) => selectedIds.has(contact.id) && contactSendablePhone(contact)
    );
    const accountId = candidates.find((contact) => contact.accountId)?.accountId;
    const ids = candidates
      .filter((contact) => !accountId || !contact.accountId || contact.accountId === accountId)
      .slice(0, BROADCAST_HARD_CAP)
      .map((contact) => contact.id);
    if (!ids.length) {
      pushToast(t("crm.noSendableContacts"), "error");
      return;
    }
    sessionStorage.setItem(BROADCAST_DRAFT_CONTACT_IDS_KEY, JSON.stringify(ids));
    if (accountId) sessionStorage.setItem(BROADCAST_DRAFT_ACCOUNT_ID_KEY, accountId);
    setActiveNav("broadcast");
    pushToast(t("crm.broadcastRecipientsAdded", { count: ids.length }), "success");
  };
  const exportSelected = () => {
    const rows = peopleContacts.filter((contact) => selectedIds.has(contact.id));
    if (!rows.length) return;
    downloadText(
      `wapplus-contacts-${localDayKey()}.csv`,
      `\ufeff${contactsToCsv(rows)}`,
      "text/csv;charset=utf-8"
    );
    pushToast(t("crm.contactsExported", { count: rows.length }), "success");
  };

  // 看板卡片稳定回调（memo 需要引用稳定）
  const handleToggleSelect = useCallback(
    (c: Contact) => toggleSelect(c.id),
    []
  );
  const handleCardClick = useCallback((c: Contact) => {
    if (wasDraggingRef.current) return;
    setSelectedContact(c.id);
    setDetailOpen(true);
  }, [setSelectedContact]);
  const handleOpenChat = useCallback(
    (c: Contact) => openContactWorkspace(c.id),
    [openContactWorkspace]
  );
  const handleScheduleFollowUp = useCallback(
    (c: Contact) => {
      const r = scheduleTomorrowFollowUp(c.id);
      if (r) pushToast(t("crm.tomorrowFollowUp", { name: contactTitle(c) }), "success");
    },
    [scheduleTomorrowFollowUp, pushToast]
  );
  const handleScheduleToday = useCallback(
    (c: Contact) => {
      const r = scheduleFollowUp(c.id, localDayKey());
      if (r) pushToast(t("crm.todayFollowUp", { name: contactTitle(c) }), "success");
    },
    [scheduleFollowUp, pushToast]
  );
  const handleScheduleAt = useCallback(
    (c: Contact, dueAt: string) => {
      const r = scheduleFollowUp(c.id, dueAt);
      if (r) {
        pushToast(
          t("crm.followUpScheduled", {
            date: dueAt.replace("T", " "),
            name: contactTitle(c),
          }),
          "success"
        );
      }
    },
    [scheduleFollowUp, pushToast]
  );
  const handleFixName = useCallback(
    (c: Contact) => {
      setSelectedContact(c.id);
      setDetailOpen(true);
    },
    [setSelectedContact]
  );

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-zinc-950">
      {/* 顶栏工具 */}
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-zinc-800/90 px-3">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold">{t("crm.title")}</div>
          <div className="text-2xs text-zinc-500">
            {q || quickFilter !== "all"
              ? t("crm.contactCount", { shown: filtered.length, total: peopleContacts.length })
              : t("crm.contactCountAll", { total: peopleContacts.length })}
          </div>
        </div>

        <div className="relative ml-2 max-w-xs flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("crm.search")}
            className="pl-7"
          />
        </div>

        <div className="hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto lg:flex">
          {(
            [
              { id: "all", label: t("crm.all") },
              {
                id: "active",
                label: t("crm.active"),
                count: filterCounts.active,
              },
              {
                id: "needs_name",
                label: t("crm.needsName"),
                count: filterCounts.needsName,
              },
              {
                id: "due_followup",
                label: t("crm.dueFollowUp"),
                count: filterCounts.dueFollowup,
              },
              {
                id: "has_note",
                label: t("crm.hasNote"),
                count: filterCounts.hasNote,
              },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => changeQuickFilter(item.id)}
              className={cn(
                "inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 text-2xs transition-colors",
                quickFilter === item.id
                  ? "bg-zinc-800 text-zinc-100 ring-1 ring-zinc-700"
                  : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
              )}
              title={
                item.id === "active"
                  ? t("crm.activeHint")
                  : item.id === "needs_name"
                  ? t("crm.needsNameHint")
                  : item.id === "due_followup"
                    ? t("crm.followUpHint")
                    : item.id === "has_note"
                      ? t("crm.noteHint")
                      : t("crm.allHint")
              }
            >
              {item.label}
              {"count" in item && item.count != null ? (
                <span className="tabular-nums text-zinc-400">{item.count}</span>
              ) : null}
            </button>
          ))}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button
            variant="secondary"
            className="!min-h-8 gap-1 !px-2.5 text-2xs"
            title={t("crm.importTitle")}
            onClick={() => setImportOpen(true)}
          >
            <FilePlus2 className="h-3.5 w-3.5" />
            {t("crm.import")}
          </Button>
          {selectMode ? (
            <Button
              variant="secondary"
              className="!min-h-8 gap-1 !px-2.5 text-2xs"
              onClick={exitSelectMode}
            >
              <X className="h-3.5 w-3.5" />
              {t("crm.exitSelect", { count: selectedIds.size })}
            </Button>
          ) : (
            <Button
              variant="secondary"
              className="!min-h-8 gap-1 !px-2.5 text-2xs"
              onClick={() => setSelectMode(true)}
            >
              <CheckSquare className="h-3.5 w-3.5" />
              {t("crm.select")}
            </Button>
          )}
          <div className="flex rounded-md border border-zinc-800 bg-zinc-900/50 p-0.5">
            <button
              type="button"
              onClick={() => changeMode("board")}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded px-2 text-2xs",
                mode === "board"
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              {t("crm.board")}
            </button>
            <button
              type="button"
              onClick={() => changeMode("list")}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded px-2 text-2xs",
                mode === "list"
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              <List className="h-3.5 w-3.5" />
              {t("crm.list")}
            </button>
          </div>
          <Button
            variant="secondary"
            className="!min-h-8 gap-1 !px-2.5 text-2xs"
            onClick={() => {
              changeMode("board");
              setAddingStage(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("crm.newStage")}
          </Button>
          <Button
            variant="primary"
            className="!min-h-8 gap-1 !px-2.5 text-2xs"
            onClick={() => setShowAdd((v) => !v)}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("crm.newContact")}
          </Button>
        </div>
      </div>

      {showAdd && (
        <div className="border-b border-zinc-800/90 bg-zinc-900/40 px-3 py-3">
          <AddContactForm
            phones={phones}
            onCancel={() => setShowAdd(false)}
            onSave={(c) => {
              addContact(c);
              setShowAdd(false);
              pushToast(t("crm.created", { name: c.name }), "success");
            }}
          />
        </div>
      )}

      {selectMode && (
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800/90 bg-zinc-900/40 px-3 py-2">
          <span className="text-[11px] font-medium text-zinc-400">
            {t("crm.selected", { count: selectedIds.size })}
          </span>
          <Button
            variant="ghost"
            className="!min-h-7 !px-2 text-2xs"
            onClick={selectAllVisible}
          >
            {t("crm.selectAll")}
          </Button>
          <div className="mx-1 h-4 w-px bg-zinc-800" />
          <div className="flex items-center gap-1">
            <CalendarDays className="h-3.5 w-3.5 text-zinc-500" />
            <input
              type="date"
              value={bulkFollowUpDate}
              onChange={(event) => setBulkFollowUpDate(event.target.value)}
              className="ui-control h-7 rounded-md px-1.5 text-[12px]"
            />
            <Button
              variant="secondary"
              className="!min-h-7 !px-2 text-2xs"
              disabled={!selectedIds.size || !bulkFollowUpDate}
              onClick={applyBulkFollowUp}
            >
              {t("crm.schedule")}
            </Button>
          </div>
          <div className="mx-1 h-4 w-px bg-zinc-800" />
          <Button
            variant="secondary"
            className="!min-h-7 gap-1 !px-2 text-2xs"
            disabled={!selectedIds.size}
            onClick={addSelectedToBroadcast}
          >
            <Megaphone className="h-3.5 w-3.5" />
            {t("crm.addBroadcast")}
          </Button>
          <Button
            variant="secondary"
            className="!min-h-7 gap-1 !px-2 text-2xs"
            disabled={!selectedIds.size}
            onClick={exportSelected}
          >
            <Download className="h-3.5 w-3.5" />
            {t("crm.export")}
          </Button>
          <div className="mx-1 h-4 w-px bg-zinc-800" />
          <div className="flex items-center gap-1">
            <Tag className="h-3.5 w-3.5 text-zinc-500" />
            <Input
              value={bulkTagDraft}
              onChange={(e) => setBulkTagDraft(e.target.value)}
              placeholder={t("crm.addTagPlaceholder")}
              className="h-7 w-40 text-[12px]"
              onKeyDown={(e) => {
                if (e.key === "Enter") applyBulkTag();
              }}
            />
            <Button
              variant="secondary"
              className="!min-h-7 !px-2 text-2xs"
              disabled={!bulkTagDraft.trim() || !selectedIds.size}
              onClick={applyBulkTag}
            >
              {t("crm.addTag")}
            </Button>
          </div>
          <div className="mx-1 h-4 w-px bg-zinc-800" />
          <div className="flex items-center gap-1">
            <span className="text-2xs text-zinc-500">{t("crm.moveStage")}</span>
            <select
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (v) applyBulkStage(v as SalesStage);
              }}
              className="ui-control h-7 rounded-md px-1.5 text-[12px]"
            >
              <option value="">{t("crm.choose")}</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* 主区：看板或列表 */}
        <div className="min-w-0 flex-1 overflow-hidden">
          {mode === "board" ? (
            <div className="flex h-full gap-2 overflow-x-auto p-3">
              {stages.map((stage) => (
                <div
                  key={stage.id}
                  ref={(el) => {
                    stageColRefs.current[stage.id] = el;
                  }}
                  className={cn(
                    "crm-kanban-col flex w-60 shrink-0 flex-col rounded-xl border bg-zinc-900/50 dark:bg-zinc-900/40 transition-colors shadow-2xs",
                    dragOverStage === stage.id
                      ? "border-brand/50 bg-brand/5"
                      : "border-zinc-800/90"
                  )}
                >
                  <div className="group/stage flex items-center justify-between gap-1 border-b border-zinc-800/80 px-2.5 py-2">
                    {editingStageId === stage.id ? (
                      <input
                        autoFocus
                        value={stageNameDraft}
                        maxLength={20}
                        onChange={(e) => setStageNameDraft(e.target.value)}
                        onBlur={() => saveStageLabel(stage.id, stageNameDraft)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            saveStageLabel(stage.id, stageNameDraft);
                          }
                          if (e.key === "Escape") {
                            e.preventDefault();
                            setEditingStageId(null);
                            setStageNameDraft("");
                          }
                        }}
                        className="ui-control h-7 min-w-0 flex-1 px-1.5 text-[12px] font-semibold"
                        title={t("crm.saveHint")}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingStageId(stage.id);
                          setStageNameDraft(stage.label);
                        }}
                        className="min-w-0 flex-1 truncate rounded px-0.5 text-left text-[12px] font-semibold text-zinc-200 hover:bg-zinc-800/80 hover:text-white"
                        title={t("crm.editStageHint")}
                      >
                        {stage.label}
                      </button>
                    )}
                    <Badge className="tabular-nums">
                      {byStage[stage.id].length}
                    </Badge>
                    <div className="hidden shrink-0 items-center group-hover/stage:flex">
                      <button
                        type="button"
                        disabled={stages[0]?.id === stage.id}
                        className="rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-20"
                        title={t("crm.moveLeft")}
                        onClick={() => moveStage(stage.id, -1)}
                      >
                        <ChevronLeft className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        disabled={stages.at(-1)?.id === stage.id}
                        className="rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-20"
                        title={t("crm.moveRight")}
                        onClick={() => moveStage(stage.id, 1)}
                      >
                        <ChevronRight className="h-3 w-3" />
                      </button>
                      {!DEFAULT_STAGES.some((item) => item.id === stage.id) && (
                        <button
                          type="button"
                          className="rounded p-0.5 text-zinc-500 hover:bg-rose-500/15 hover:text-rose-300"
                          title={t("crm.deleteStage")}
                          onClick={() => void removeStage(stage.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                  {byStage[stage.id].length ? (
                    <Virtuoso
                      className="min-h-0 flex-1"
                      data={byStage[stage.id]}
                      computeItemKey={(_index, c) => c.id}
                      defaultItemHeight={92}
                      increaseViewportBy={120}
                      itemContent={(_index, c) => (
                        <div className="px-2 pt-1.5">
                        <CrmBoardCard
                          contact={c}
                          selected={selectedContactId === c.id}
                          dragging={
                            pointerDrag?.contactId === c.id && pointerDrag.active
                          }
                          due={dueContactIds.has(c.id)}
                          unread={unreadByContactId.get(c.id) || 0}
                          selectMode={selectMode}
                          checked={selectedIds.has(c.id)}
                          onToggleSelect={handleToggleSelect}
                          onPointerDown={startCardDrag}
                          onClick={handleCardClick}
                          onOpenChat={handleOpenChat}
                          onScheduleToday={handleScheduleToday}
                          onScheduleFollowUp={handleScheduleFollowUp}
                          onScheduleAt={handleScheduleAt}
                          onFixName={handleFixName}
                        />
                        </div>
                      )}
                    />
                  ) : (
                    <div className="px-1 py-8 text-center text-xs font-medium text-zinc-500 dark:text-zinc-500">
                      {t("crm.dropHere")}
                    </div>
                  )}
                </div>
              ))}
              {addingStage ? (
                <div className="w-56 shrink-0 self-start rounded-lg border border-brand/30 bg-brand/5 p-2">
                  <Input
                    autoFocus
                    value={newStageName}
                    maxLength={20}
                    placeholder={t("crm.stageName")}
                    onChange={(event) => setNewStageName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") addStage();
                      if (event.key === "Escape") {
                        setAddingStage(false);
                        setNewStageName("");
                      }
                    }}
                  />
                  <div className="mt-2 flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      className="!min-h-7 !px-2 text-2xs"
                      onClick={() => {
                        setAddingStage(false);
                        setNewStageName("");
                      }}
                    >
                      {t("crm.cancel")}
                    </Button>
                    <Button
                      variant="primary"
                      className="!min-h-7 !px-2 text-2xs"
                      disabled={!newStageName.trim()}
                      onClick={addStage}
                    >
                      {t("crm.add")}
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="flex h-20 w-40 shrink-0 items-center justify-center gap-1 rounded-lg border border-dashed border-zinc-800 text-[12px] text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
                  onClick={() => setAddingStage(true)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("crm.addStage")}
                </button>
              )}
            </div>
          ) : (
            <div className="flex h-full">
              <div className="flex w-80 shrink-0 flex-col border-r border-zinc-800/90">
                {filtered.length ? (
                  <Virtuoso
                    ref={listVirtuosoRef}
                    className="min-h-0 flex-1"
                    data={filtered}
                    computeItemKey={(_index, c) => c.id}
                    defaultItemHeight={74}
                    increaseViewportBy={120}
                    itemContent={(_index, c) => {
                    const title = contactTitle(c);
                    const tip = insightLine(c, 36);
                    const due = dueContactIds.has(c.id);
                    return (
                    <div className="px-1 pt-1">
                      <ListRow
                        active={selectedContactId === c.id}
                        onClick={() =>
                          selectMode ? toggleSelect(c.id) : setSelectedContact(c.id)
                        }
                        className="!items-center gap-2 !py-2"
                      >
                        {selectMode ? (
                          <input
                            type="checkbox"
                            checked={selectedIds.has(c.id)}
                            readOnly
                            tabIndex={-1}
                            className="pointer-events-none h-4 w-4 shrink-0 accent-emerald-500"
                            aria-label={t("tooltip.selectContact", { name: title })}
                          />
                        ) : null}
                        <Avatar
                          name={title}
                          seed={c.phone || c.id}
                          src={c.avatarUrl}
                          size="sm"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1">
                            <span className="truncate text-[13px] font-medium">
                              {title}
                            </span>
                            {due ? (
                              <Clock3 className="h-3 w-3 shrink-0 text-rose-300" />
                            ) : null}
                            {(unreadByContactId.get(c.id) || 0) > 0 ? (
                              <span className="ml-auto shrink-0 rounded-full bg-brand/15 px-1.5 text-2xs tabular-nums text-brand">
                                {unreadByContactId.get(c.id)}
                              </span>
                            ) : null}
                          </div>
                          <span className="truncate text-2xs text-zinc-500">
                            {displayPhone(c.phone) || c.phone || t("crm.noPhone")}
                          </span>
                          <span className="text-2xs text-brand">
                            {stages.find((s) => s.id === c.stage)?.label}
                          </span>
                          {tip && (
                            <span
                              className="line-clamp-2 w-full text-2xs leading-3.5 text-zinc-500"
                              title={insightLine(c, 200) || undefined}
                            >
                              {tip}
                            </span>
                          )}
                        </div>
                      </ListRow>
                    </div>
                    );
                    }}
                  />
                ) : (
                  <EmptyState title={t("crm.noMatch")} description={t("crm.adjustSearch")} />
                )}
              </div>
              <div className="min-w-0 flex-1 overflow-y-auto p-4">
                {contact ? (
                  <ContactEditor
                    contact={contact}
                    title={contactTitle(contact)}
                    needsName={needsDisplayName(contact)}
                    phones={phones}
                    stages={stages}
                    updateContact={updateContact}
                    openContactWorkspace={openContactWorkspace}
                    scheduleFollowUp={scheduleFollowUp}
                    scheduleTomorrowFollowUp={scheduleTomorrowFollowUp}
                    pushToast={pushToast}
                  />
                ) : (
                  <EmptyState
                    title={t("crm.selectContact")}
                    description={t("crm.selectContactHint")}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* 看板详情按需展开，不在空闲时长期占宽 */}
        {mode === "board" && detailOpen && contact && (
          <div className="w-[360px] shrink-0 overflow-y-auto border-l border-zinc-800/90 bg-zinc-950 p-3">
            <div className="mb-3 flex items-center justify-between border-b border-zinc-800/80 pb-2">
              <span className="text-[12px] font-semibold text-zinc-300">{t("crm.details")}</span>
              <Button
                variant="ghost"
                className="!min-h-7 !px-2 text-2xs"
                onClick={() => setDetailOpen(false)}
              >
                <X className="h-3.5 w-3.5" />
                {t("crm.collapse")}
              </Button>
            </div>
              <ContactEditor
                contact={contact}
                title={contactTitle(contact)}
                needsName={needsDisplayName(contact)}
                phones={phones}
                stages={stages}
                updateContact={updateContact}
                openContactWorkspace={openContactWorkspace}
                scheduleFollowUp={scheduleFollowUp}
                scheduleTomorrowFollowUp={scheduleTomorrowFollowUp}
                pushToast={pushToast}
                compact
              />
          </div>
        )}
      </div>

      <ContactImportModal open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}
