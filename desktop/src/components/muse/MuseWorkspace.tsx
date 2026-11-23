import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, PanelLeftClose, PanelLeftOpen, Pencil, Plus, RefreshCw, Search, Star, Trash2, X } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { addMuseWebAccount, advanceMuseWebSideChatCleanup, cancelMuseWebSideChatCleanup, deleteMuseWebSideChats, museWebAccounts, museWebCleanupSchedules, museWebSideChats, museWebStatus, museWebWorkspaceAccount, openMuseWeb, removeMuseWebAccount, scheduleMuseWebSideChatCleanup, setMuseWorkspaceContentVisible, setMuseWorkspaceSidebarCollapsed, updateMuseWebAccount, updateMuseWebSideChatCleanup, type MuseSideChat, type MuseSideChatCleanup, type MuseWebAccount, type MuseWebAccountPool, type MuseWebStatus } from "@/lib/museWeb";
import { museQueueSnapshot, subscribeMuseQueue } from "@/lib/museQueue";
import { useI18n } from "@/i18n";
import { resumeMuseWebSideChatCleanup } from "@/lib/museWeb";

type WorkspaceWindow = Window & { __museWorkspaceAccount?: string };
type AccountStatus = Pick<MuseWebStatus, "ready" | "state" | "message"> & { checkedAt: number };
type AccountStatusFilter = "all" | "ready" | "login" | "quota" | "busy" | "error" | "checking" | "unconfirmed" | "unchecked";
const CLEANUP_GRACE_MS = 15 * 60_000;

function localDateTimeInput(minutes = 10) {
  const date = new Date(Date.now() + minutes * 60_000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function MuseWorkspace() {
  const { t } = useI18n();
  const [pool, setPool] = useState<MuseWebAccountPool>();
  const [activeId, setActiveId] = useState(() => (window as WorkspaceWindow).__museWorkspaceAccount || "");
  const [accountSidebarCollapsed, setAccountSidebarCollapsed] = useState(false);
  const [sidebarToggleBusy, setSidebarToggleBusy] = useState(false);
  const [accountSearch, setAccountSearch] = useState("");
  const [accountStatusFilter, setAccountStatusFilter] = useState<AccountStatusFilter>("all");
  const [statuses, setStatuses] = useState<Record<string, AccountStatus>>({});
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [editingAccount, setEditingAccount] = useState<MuseWebAccount>();
  const [removingAccount, setRemovingAccount] = useState<MuseWebAccount>();
  const [accountContextMenu, setAccountContextMenu] = useState<{ account: MuseWebAccount; x: number; y: number } | null>(null);
  const accountContextMenuRef = useRef<HTMLDivElement>(null);
  const [editName, setEditName] = useState("");
  const [editNote, setEditNote] = useState("");
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupChats, setCleanupChats] = useState<MuseSideChat[]>([]);
  const [cleanupSchedules, setCleanupSchedules] = useState<MuseSideChatCleanup[]>([]);
  const [cleanupMode, setCleanupMode] = useState<"once" | "repeat">("once");
  const [selectedChats, setSelectedChats] = useState<Set<string>>(new Set());
  const [excludedChatIds, setExcludedChatIds] = useState<Set<string>>(new Set());
  const [cleanupDueAt, setCleanupDueAt] = useState(localDateTimeInput);
  const [cleanupRepeatDays, setCleanupRepeatDays] = useState("7");
  const [cleanupRepeatDueAt, setCleanupRepeatDueAt] = useState(() => localDateTimeInput(7 * 24 * 60));
  const [cleanupScheduleProcessing, setCleanupScheduleProcessing] = useState("");
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [confirmRepeatCleanup, setConfirmRepeatCleanup] = useState(false);
  const [cleanupError, setCleanupError] = useState("");
  const [resetHelpOpen, setResetHelpOpen] = useState(false);
  const autoCheckStarted = useRef(false);
  const cleanupScheduleRunning = useRef(false);
  const queue = useSyncExternalStore(subscribeMuseQueue, museQueueSnapshot);
  const queueBusy = !!(queue.textRunning || queue.textWaiting || queue.mediaRunning || queue.mediaWaiting);
  const cleanupInProgress = !!cleanupScheduleProcessing;
  const cleanupProcessingAccountId = cleanupSchedules.find(task => task.id === cleanupScheduleProcessing)?.accountId;

  useEffect(() => {
    if (!accountContextMenu) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !accountContextMenuRef.current?.contains(event.target)) setAccountContextMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountContextMenu(null);
    };
    const close = () => setAccountContextMenu(null);
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("keydown", closeOnEscape, true);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("keydown", closeOnEscape, true);
      window.removeEventListener("blur", close);
    };
  }, [accountContextMenu]);

  useEffect(() => {
    let mounted = true;
    let activeAccountChanged = false;
    let stopActive: (() => void) | undefined;
    let stopPool: (() => void) | undefined;
    const initialize = async () => {
      const [activeListener, poolListener] = await Promise.all([
        listen<string>("muse-workspace-active-account", event => {
          activeAccountChanged = true;
          if (mounted) setActiveId(event.payload);
        }),
        listen<MuseWebAccountPool>("muse-workspace-account-pool", event => {
          if (mounted) setPool(event.payload);
        }),
      ]);
      if (!mounted) {
        activeListener();
        poolListener();
        return;
      }
      stopActive = activeListener;
      stopPool = poolListener;
      const [value, workspaceAccountId, cleanupTasks] = await Promise.all([museWebAccounts(), museWebWorkspaceAccount(), museWebCleanupSchedules()]);
      if (!mounted) return;
      setPool(value);
      setCleanupSchedules(cleanupTasks);
      if (!activeAccountChanged) setActiveId(value.accounts.some(account => account.id === workspaceAccountId) ? workspaceAccountId : "");
    };
    void initialize().catch(reason => {
      if (!mounted) return;
      setError(true);
      setMessage(reason instanceof Error ? reason.message : String(reason));
    });
    return () => {
      mounted = false;
      stopActive?.();
      stopPool?.();
    };
  }, []);

  const statusText = (status?: AccountStatus) => {
    if (!status) return t("muse.statusUnknown");
    if (status.ready) return t("muse.statusReady");
    if (status.state === "checking" || status.state === "loading") return t("muse.statusChecking");
    if (status.state === "unconfirmed") return t("muse.statusUnconfirmed");
    if (status.state === "login") return t("muse.statusLogin");
    if (status.state === "quota") return t("muse.statusQuota");
    if (status.state === "busy") return t("muse.statusBusy");
    return t("muse.statusError");
  };

  const checkOne = async (accountId: string): Promise<AccountStatus> => {
    setStatuses(current => ({ ...current, [accountId]: { ready: false, state: "checking", message: "", checkedAt: Date.now() } }));
    try {
      const status = await museWebStatus(false, accountId);
      const checked = { ...status, checkedAt: Date.now() };
      setStatuses(current => ({ ...current, [accountId]: checked }));
      return checked;
    } catch (reason) {
      const status = { ready: false, state: "error", message: reason instanceof Error ? reason.message : String(reason), checkedAt: Date.now() };
      setStatuses(current => ({ ...current, [accountId]: status }));
      return status;
    }
  };

  const checkAll = async (refreshPool = false) => {
    if (!pool || busy || checking || queueBusy) return;
    setChecking(true);
    setMessage("");
    setError(false);
    try {
      const currentPool = refreshPool ? await museWebAccounts() : pool;
      if (refreshPool) setPool(currentPool);
      const results: AccountStatus[] = [];
      for (let index = 0; index < currentPool.accounts.length; index += 2) {
        results.push(...await Promise.all(currentPool.accounts.slice(index, index + 2).map(account => checkOne(account.id))));
      }
      const ready = results.filter(status => status.ready).length;
      setMessage(t("muse.poolChecked", { ready, total: currentPool.accounts.length }));
    } catch (reason) {
      setError(true);
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setChecking(false);
    }
  };

  const checkAllRef = useRef<() => void>(() => undefined);
  checkAllRef.current = () => { void checkAll(); };
  useEffect(() => {
    if (!pool || autoCheckStarted.current || queueBusy) return;
    autoCheckStarted.current = true;
    checkAllRef.current();
  }, [pool, queueBusy]);

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (stopped || cleanupScheduleRunning.current) return;
      cleanupScheduleRunning.current = true;
      try {
        for (const task of cleanupSchedules) {
          if (stopped || task.error) continue;
          if (task.repeatEveryDays && task.identityScheme !== 2) {
            const reason = t("muse.cleanupPlanReview");
            try {
              const updated = await updateMuseWebSideChatCleanup(task.id, [], reason);
              setCleanupSchedules(updated);
              if (!stopped) { setError(true); setMessage(reason); }
            } catch (failure) {
              if (!stopped) { setError(true); setMessage(failure instanceof Error ? failure.message : reason); }
            }
            continue;
          }
          if (task.dueAtMs > Date.now()) continue;
          const now = Date.now();
          if (now - task.dueAtMs > CLEANUP_GRACE_MS) {
            try {
              const reason = t("muse.cleanupScheduleExpired");
              setCleanupSchedules(await updateMuseWebSideChatCleanup(task.id, task.chats, reason));
              if (!stopped) { setError(true); setMessage(reason); }
            } catch (reason) {
              if (!stopped) { setError(true); setMessage(String(reason)); }
            }
            continue;
          }
          if (task.accountId !== activeId || queueBusy || busy || checking || cleanupOpen || editingAccount || removingAccount) continue;
          setCleanupScheduleProcessing(task.id);
          try {
            if (task.repeatEveryDays) {
              // Persist the next run before deleting so an interrupted run cannot retry every 15 seconds.
              const updated = await advanceMuseWebSideChatCleanup(task.id);
              setCleanupSchedules(updated);
              const excluded = new Set(task.excludedChatIds || []);
              const current = await museWebSideChats(task.accountId);
              if ([...excluded].some(id => id.startsWith("title:") && !current.some(chat => chat.id === id))) {
                throw Error(t("muse.cleanupExcludedChanged"));
              }
              const targets = current.filter(chat => !excluded.has(chat.id) && !chat.ambiguous);
              for (let index = 0; index < targets.length; index += 50) {
                const result = await deleteMuseWebSideChats(task.accountId, targets.slice(index, index + 50));
                if (result.error) throw Error(result.error);
              }
              const remaining = (await museWebSideChats(task.accountId)).filter(chat => !excluded.has(chat.id) && !chat.ambiguous);
              if (remaining.length) throw Error(t("muse.cleanupScheduleIncomplete", { count: remaining.length }));
              if (!stopped) {
                setError(false);
                setMessage(t("muse.cleanupRepeatDone", { count: targets.length, account: pool?.accounts.find(account => account.id === task.accountId)?.name || task.accountId }));
              }
              continue;
            }
            const before = new Set((await museWebSideChats(task.accountId)).map(chat => chat.id));
            const targets = task.chats.filter(chat => before.has(chat.id));
            const result = targets.length ? await deleteMuseWebSideChats(task.accountId, targets) : { error: null };
            let current: MuseSideChat[];
            try { current = await museWebSideChats(task.accountId); }
            catch { current = task.chats; }
            const remaining = task.chats.filter(chat => current.some(item => item.id === chat.id));
            if (!remaining.length) {
              const updated = await updateMuseWebSideChatCleanup(task.id, [], undefined);
              setCleanupSchedules(updated);
              if (!stopped) {
                setError(false);
                setMessage(t("muse.cleanupScheduleDone", { count: task.chats.length, account: pool?.accounts.find(account => account.id === task.accountId)?.name || task.accountId }));
              }
            } else {
              const reason = result.error || t("muse.cleanupScheduleIncomplete");
              const updated = await updateMuseWebSideChatCleanup(task.id, remaining, reason);
              setCleanupSchedules(updated);
              if (!stopped) { setError(true); setMessage(reason); }
            }
          } catch (reason) {
            const detail = reason instanceof Error ? reason.message : t("muse.cleanupScheduleIncomplete");
            try {
              const updated = await updateMuseWebSideChatCleanup(task.id, task.chats, detail);
              setCleanupSchedules(updated);
            } catch { /* Keep the saved plan for manual inspection if persistence also fails. */ }
            if (!stopped) { setError(true); setMessage(detail); }
          } finally {
            setCleanupScheduleProcessing("");
          }
        }
      } finally {
        cleanupScheduleRunning.current = false;
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 15_000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [cleanupSchedules, activeId, queueBusy, busy, checking, cleanupOpen, editingAccount, removingAccount, pool, t]);

  const addAccount = async () => {
    if (busy || queueBusy || cleanupInProgress) return;
    setBusy(true);
    setMessage("");
    setError(false);
    try {
      const next = await addMuseWebAccount();
      setPool(next);
      const addedId = next.accounts.at(-1)?.id;
      if (!addedId) throw new Error("Muse 新账号创建结果无效");
      await openMuseWeb(false, addedId);
      setActiveId(addedId);
      setMessage(t("muse.accountAdded"));
    } catch (reason) {
      setError(true);
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const toggleAccountSidebar = async () => {
    if (sidebarToggleBusy) return;
    const collapsed = !accountSidebarCollapsed;
    setSidebarToggleBusy(true);
    try {
      await setMuseWorkspaceSidebarCollapsed(collapsed);
      setAccountSidebarCollapsed(collapsed);
    } catch (reason) {
      setError(true);
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSidebarToggleBusy(false);
    }
  };

  const selectAccount = async (accountId: string) => {
    if (accountId === activeId || busy || queueBusy || cleanupOpen || editingAccount || cleanupInProgress) return;
    setBusy(true);
    setMessage("");
    setError(false);
    try {
      await openMuseWeb(false, accountId);
      setActiveId(accountId);
      const previousState = statuses[accountId]?.state;
      if (!checking && (previousState === "unconfirmed" || previousState === "error")) {
        void checkOne(accountId);
      }
    } catch (reason) {
      setError(true);
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const editAccount = (account: MuseWebAccount) => {
    setEditingAccount(account);
    setEditName(account.name);
    setEditNote(account.note || "");
  };

  const saveAccount = async () => {
    if (!editingAccount || busy) return;
    setBusy(true);
    setMessage("");
    setError(false);
    try {
      setPool(await updateMuseWebAccount(editingAccount.id, editName, editNote));
      setEditingAccount(undefined);
      setMessage(t("muse.accountUpdated"));
    } catch (reason) {
      setError(true);
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const removeAccount = async () => {
    if (!removingAccount || !pool || pool.accounts.length <= 1 || busy || queueBusy || (cleanupInProgress && removingAccount.id === cleanupProcessingAccountId)) return;
    setBusy(true);
    setMessage("");
    setError(false);
    try {
      const result = await removeMuseWebAccount(removingAccount.id);
      setPool(result.pool);
      if (activeId === removingAccount.id) setActiveId(result.pool.selectedId);
      setStatuses(current => {
        const next = { ...current };
        delete next[removingAccount.id];
        return next;
      });
      setRemovingAccount(undefined);
      setError(!!result.cleanupWarning);
      setMessage(result.cleanupWarning
        ? t("muse.accountRemovedCleanupWarning", { name: removingAccount.name, reason: result.cleanupWarning })
        : t("muse.accountRemoved", { name: removingAccount.name }));
    } catch (reason) {
      setRemovingAccount(undefined);
      setError(true);
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const openCleanup = async () => {
    if (!activeId || busy || queueBusy || cleanupInProgress) return;
    setCleanupOpen(true);
    setCleanupLoading(true);
    setCleanupError("");
    setCleanupChats([]);
    setSelectedChats(new Set());
    setExcludedChatIds(new Set());
    setCleanupMode("once");
    try {
      const [chats, tasks] = await Promise.all([museWebSideChats(activeId), museWebCleanupSchedules()]);
      setCleanupChats(chats);
      setCleanupSchedules(tasks);
      const recurring = tasks.find(task => task.accountId === activeId && task.repeatEveryDays);
      if (recurring) {
        setCleanupMode("repeat");
        if (recurring.identityScheme !== 2) setCleanupError(t("muse.cleanupPlanReview"));
        else {
          const currentUnambiguousIds = new Set(chats.filter(chat => !chat.ambiguous).map(chat => chat.id));
          setExcludedChatIds(new Set((recurring.excludedChatIds || []).filter(id => currentUnambiguousIds.has(id))));
        }
        setCleanupRepeatDays(String(recurring.repeatEveryDays));
      }
      setCleanupRepeatDueAt(localDateTimeInput((recurring?.repeatEveryDays || 7) * 24 * 60));
    } catch (reason) {
      setCleanupError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCleanupLoading(false);
    }
  };

  const closeCleanup = () => {
    if (cleanupLoading) return;
    setCleanupOpen(false);
    setConfirmCleanup(false);
    setConfirmRepeatCleanup(false);
    setSelectedChats(new Set());
    setExcludedChatIds(new Set());
  };

  useEffect(() => {
    if (!editingAccount && !removingAccount && !cleanupOpen) return;
    void setMuseWorkspaceContentVisible(false).catch(reason => {
      setError(true);
      setMessage(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { void setMuseWorkspaceContentVisible(true).catch(() => undefined); };
  }, [editingAccount, removingAccount, cleanupOpen]);

  const deleteSelectedChats = async () => {
    if (!activeAccount || cleanupLoading || !selectedChats.size || selectedChats.size > cleanupSelectionLimit) return;
    const selected = cleanupChats.filter(chat => selectedChats.has(chat.id));
    setCleanupLoading(true);
    setConfirmCleanup(false);
    setCleanupError("");
    try {
      const result = await deleteMuseWebSideChats(activeAccount.id, selected);
      setSelectedChats(new Set());
      if (result.deleted.length) setMessage(t("muse.cleanupDone", { count: result.deleted.length, account: activeAccount.name }));
      if (result.error) setCleanupError(result.error);
      setCleanupChats(await museWebSideChats(activeAccount.id));
    } catch (reason) {
      setCleanupError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCleanupLoading(false);
    }
  };

  const scheduleSelectedChats = async () => {
    if (!activeAccount || cleanupLoading || !selectedChats.size || selectedChats.size > cleanupSelectionLimit) return;
    const dueAtMs = new Date(cleanupDueAt).getTime();
    const selected = cleanupChats.filter(chat => selectedChats.has(chat.id));
    if (!Number.isFinite(dueAtMs) || dueAtMs <= Date.now() || selected.length !== selectedChats.size) {
      setCleanupError(t("muse.cleanupScheduleInvalidTime"));
      return;
    }
    setCleanupLoading(true);
    setCleanupError("");
    try {
      const tasks = await scheduleMuseWebSideChatCleanup({ id: crypto.randomUUID(), accountId: activeAccount.id, dueAtMs, chats: selected, error: null });
      setCleanupSchedules(tasks);
      setSelectedChats(new Set());
      setCleanupDueAt(localDateTimeInput());
      setCleanupOpen(false);
      setError(false);
      setMessage(t("muse.cleanupScheduled", { count: selected.length, time: new Date(dueAtMs).toLocaleString() }));
    } catch (reason) {
      setCleanupError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCleanupLoading(false);
    }
  };

  const scheduleRecurringCleanup = () => {
    const days = Number(cleanupRepeatDays);
    const dueAtMs = new Date(cleanupRepeatDueAt).getTime();
    if (!activeAccount || !Number.isInteger(days) || days < 1 || days > 365 || !Number.isFinite(dueAtMs) || dueAtMs <= Date.now()) {
      setCleanupError(t("muse.cleanupScheduleInvalidTime"));
      return;
    }
    if (cleanupSchedules.some(task => task.accountId === activeAccount.id && task.repeatEveryDays)) {
      setCleanupError(t("muse.cleanupRepeatExists"));
      return;
    }
    setCleanupError("");
    setConfirmRepeatCleanup(true);
  };

  const confirmRecurringCleanup = async () => {
    if (!activeAccount || cleanupLoading) return;
    const days = Number(cleanupRepeatDays);
    const dueAtMs = new Date(cleanupRepeatDueAt).getTime();
    const excluded = [...excludedChatIds];
    if (!Number.isInteger(days) || days < 1 || days > 365 || !Number.isFinite(dueAtMs) || dueAtMs <= Date.now()
      || excluded.some(id => !cleanupChats.some(chat => chat.id === id && !chat.ambiguous))) {
      setCleanupError(t("muse.cleanupScheduleInvalidTime"));
      setConfirmRepeatCleanup(false);
      return;
    }
    setCleanupLoading(true);
    setCleanupError("");
    try {
      const latestChats = await museWebSideChats(activeAccount.id);
      if (excluded.some(id => !latestChats.some(chat => chat.id === id && !chat.ambiguous))) throw Error(t("muse.cleanupScheduleInvalidTime"));
      const tasks = await scheduleMuseWebSideChatCleanup({
        id: crypto.randomUUID(), accountId: activeAccount.id, dueAtMs, chats: [], error: null,
        repeatEveryDays: days, identityScheme: 2, excludedChatIds: excluded,
      });
      setCleanupSchedules(tasks);
      setExcludedChatIds(new Set());
      setConfirmRepeatCleanup(false);
      setCleanupOpen(false);
      setError(false);
      setMessage(t("muse.cleanupRepeatScheduled", { days, time: new Date(dueAtMs).toLocaleString() }));
    } catch (reason) {
      setCleanupError(reason instanceof Error ? reason.message : String(reason));
      setConfirmRepeatCleanup(false);
    } finally {
      setCleanupLoading(false);
    }
  };

  const cancelScheduledCleanup = async (taskId: string) => {
    if (cleanupLoading || cleanupScheduleProcessing === taskId) return;
    setCleanupError("");
    try { setCleanupSchedules(await cancelMuseWebSideChatCleanup(taskId)); }
    catch (reason) { setCleanupError(reason instanceof Error ? reason.message : String(reason)); }
  };

  const resumeScheduledCleanup = async (task: MuseSideChatCleanup) => {
    if (cleanupLoading || cleanupScheduleProcessing || queueBusy || task.accountId !== activeId) return;
    setCleanupLoading(true);
    setCleanupError("");
    try {
      const updated = await resumeMuseWebSideChatCleanup(task.id, task.accountId);
      setCleanupSchedules(updated);
      closeCleanup();
      setError(false);
      setMessage(t("muse.cleanupScheduleResumed"));
    } catch (reason) {
      setCleanupError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCleanupLoading(false);
    }
  };

  const selectableChats = cleanupChats.filter(chat => !chat.ambiguous);
  const recurringExclusionCandidates = cleanupChats.filter(chat => !chat.ambiguous);
  const recurringIncludeCount = recurringExclusionCandidates.filter(chat => !excludedChatIds.has(chat.id)).length;
  const cleanupSelectionLimit = 50;
  const allChatsSelected = selectableChats.length > 0 && selectableChats.slice(0, cleanupSelectionLimit).every(chat => selectedChats.has(chat.id));
  const allRecurringExclusionsSelected = recurringExclusionCandidates.length > 0 && recurringExclusionCandidates.every(chat => excludedChatIds.has(chat.id));

  const readyCount = pool?.accounts.filter(account => statuses[account.id]?.ready).length || 0;
  const loggedInCount = pool?.accounts.filter(account => {
    const status = statuses[account.id];
    return status?.ready || status?.state === "quota" || status?.state === "busy";
  }).length || 0;
  const activeAccount = pool?.accounts.find(account => account.id === activeId);
  const accountCleanupSchedules = activeAccount ? cleanupSchedules.filter(task => task.accountId === activeAccount.id) : [];
  const accountRecurringCleanup = accountCleanupSchedules.find(task => !!task.repeatEveryDays);
  const accountQuery = accountSearch.trim().toLocaleLowerCase();
  const visibleAccounts = (pool?.accounts || []).map((account, index) => ({ account, index })).filter(({ account }) => {
    if (accountQuery && !`${account.name} ${account.note}`.toLocaleLowerCase().includes(accountQuery)) return false;
    const status = statuses[account.id];
    switch (accountStatusFilter) {
      case "ready": return !!status?.ready;
      case "login": return status?.state === "login";
      case "quota": return status?.state === "quota";
      case "busy": return status?.state === "busy";
      case "error": return status?.state === "error";
      case "unconfirmed": return status?.state === "unconfirmed";
      case "checking": return status?.state === "checking" || status?.state === "loading";
      case "unchecked": return !status;
      default: return true;
    }
  });

  const stateTone = (status?: AccountStatus) => {
    if (status?.ready) return "text-emerald-700";
    if (status?.state === "busy") return "text-sky-700";
    if (status?.state === "quota" || status?.state === "login" || status?.state === "unconfirmed") return "text-amber-700";
    if (status?.state === "error") return "text-rose-700";
    return "text-slate-500";
  };
  const checkedAtText = (status?: AccountStatus) => {
    if (!status || status.state === "checking") return "";
    return t("muse.statusCheckedAt", { time: new Date(status.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) });
  };

  return (
    <div className="flex h-screen min-h-0 flex-col bg-slate-50 text-slate-900">
      <header className="z-10 flex h-[76px] shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-5 shadow-sm">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-sm font-bold text-white shadow-md shadow-blue-200">M</div>
        <div className="min-w-0">
          <h1 className="text-base font-semibold tracking-tight">{t("muse.workspaceTitle")}</h1>
          <p className="mt-0.5 text-xs text-slate-500">{t("muse.workspaceSubtitle")}</p>
        </div>
        <button type="button" aria-label={t(accountSidebarCollapsed ? "muse.showAccountPool" : "muse.hideAccountPool")} aria-expanded={!accountSidebarCollapsed} title={t(accountSidebarCollapsed ? "muse.showAccountPool" : "muse.hideAccountPool")} disabled={sidebarToggleBusy} onClick={() => void toggleAccountSidebar()} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50">
          {accountSidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden="true" /> : <PanelLeftClose className="h-4 w-4" aria-hidden="true" />}
        </button>
        {!message && pool && <div className="ml-auto hidden items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 xl:flex">
          <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]" />
          <span className="whitespace-nowrap text-xs font-medium text-slate-600">{t("muse.poolCount", { signedIn: loggedInCount, ready: readyCount, unchecked: pool.accounts.length - Object.keys(statuses).length, total: pool.accounts.length })}</span>
        </div>}
        {message && <p role={error ? "alert" : "status"} className="ml-auto max-w-[30%] truncate text-xs text-slate-600">{message}</p>}
        <div className={`${message || !pool ? "ml-auto" : ""} flex shrink-0 gap-2`}>
          <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50" disabled={!pool || busy || checking || queueBusy || cleanupOpen || !!editingAccount || !!removingAccount} onClick={() => void checkAll(true)}>
            {checking ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
            {checking ? t("muse.statusChecking") : t("muse.checkAll")}
          </button>
          <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 shadow-sm transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50" disabled={!activeAccount || busy || queueBusy || cleanupOpen || !!editingAccount || !!removingAccount || cleanupInProgress} onClick={() => void openCleanup()}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />{t("muse.cleanupAction")}
          </button>
          <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-3.5 text-xs font-semibold text-white shadow-sm shadow-blue-200 transition hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50" disabled={!pool || busy || checking || queueBusy || cleanupOpen || !!editingAccount || !!removingAccount || cleanupInProgress} onClick={() => void addAccount()}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />{t("muse.addAccount")}
          </button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        {!accountSidebarCollapsed && <aside className="flex w-[260px] shrink-0 flex-col border-r border-slate-200 bg-[#f4f7fc]">
          <div className="shrink-0 border-b border-slate-200 bg-white/80 px-4 py-4">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight text-slate-900">{t("muse.poolTitle")}</span>
              <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-500">{pool ? pool.accounts.length : "…"}</span>
            </div>
          </div>
          <div className="shrink-0 space-y-2 border-b border-slate-200 px-3 py-3">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input aria-label={t("muse.accountSearch")} placeholder={t("muse.accountSearch")} value={accountSearch} onChange={event => setAccountSearch(event.target.value)} className="h-8 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-2 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
            </label>
            <select aria-label={t("muse.accountFilter")} value={accountStatusFilter} onChange={event => setAccountStatusFilter(event.target.value as AccountStatusFilter)} className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100">
              <option value="all">{t("muse.filterAll")}</option>
              <option value="ready">{t("muse.statusReady")}</option>
              <option value="login">{t("muse.statusLogin")}</option>
              <option value="quota">{t("muse.statusQuota")}</option>
              <option value="busy">{t("muse.statusBusy")}</option>
              <option value="error">{t("muse.statusError")}</option>
              <option value="unconfirmed">{t("muse.statusUnconfirmed")}</option>
              <option value="checking">{t("muse.statusChecking")}</option>
              <option value="unchecked">{t("muse.statusUnknown")}</option>
            </select>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3" aria-label={t("muse.poolTitle")}>
            {visibleAccounts.map(({ account, index }) => {
              const active = account.id === activeId;
              const status = statuses[account.id];
              return (
                <div key={account.id} onContextMenu={event => { event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect(); setAccountContextMenu({ account, x: Math.max(bounds.left + 8, Math.min(event.clientX, bounds.right - 216)), y: event.clientY }); }} className={`group relative flex min-h-[76px] items-center gap-1.5 rounded-xl border px-2 transition-all ${active ? "border-blue-200 bg-white shadow-sm shadow-blue-100" : "border-transparent bg-white/65 hover:border-slate-200 hover:bg-white hover:shadow-sm"}`}>
                  {active && <span className="absolute bottom-3 left-0 top-3 w-1 rounded-r-full bg-blue-600" />}
                  <button type="button" aria-pressed={active} disabled={busy || queueBusy || cleanupOpen || !!editingAccount || !!removingAccount || cleanupInProgress} onClick={() => void selectAccount(account.id)} className="flex min-w-0 flex-1 items-center gap-2.5 py-2 text-left disabled:cursor-wait disabled:opacity-70">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-[11px] font-semibold ${active ? "bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-sm shadow-blue-200" : "bg-slate-100 text-slate-600"}`}>{String(index + 1).padStart(2, "0")}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-start gap-1.5 text-[13px] font-semibold leading-4 text-slate-900" title={account.note ? `${account.name} · ${account.note}` : account.name}>
                        <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{account.name}</span>
                        {account.primary && <span title={t("muse.primaryAccount")}><Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" aria-hidden="true" /></span>}
                      </span>
                      {account.note && <span className="mt-1 block truncate text-[10px] leading-3 text-slate-500" title={account.note}>{account.note}</span>}
                      <span className="mt-1.5 flex min-w-0 items-center gap-1.5 truncate text-[11px]">
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${status?.ready ? "bg-emerald-500" : status?.state === "checking" || status?.state === "loading" ? "animate-pulse bg-blue-500" : status?.state === "login" || status?.state === "quota" ? "bg-amber-500" : status?.state === "error" ? "bg-rose-500" : "bg-slate-300"}`} />
                        <span className={`truncate ${stateTone(status)}`} title={status?.message || statusText(status)}>{statusText(status)}</span>
                        {status && status.state !== "checking" && <span className="shrink-0 text-slate-400">· {checkedAtText(status)}</span>}
                      </span>
                      {status?.state === "error" && status.message && <span className="mt-1 block break-words text-[11px] leading-4 text-rose-600">{status.message}</span>}
                      {status?.state === "unconfirmed" && <span className="mt-1 block break-words text-[11px] leading-4 text-amber-700">{t("muse.statusUnconfirmedHint")}</span>}
                    </span>
                  </button>
                </div>
              );
            })}
            {!pool && <p className="px-3 py-4 text-xs text-slate-500">{t("muse.poolLoading")}</p>}
            {pool && visibleAccounts.length === 0 && <p className="px-3 py-5 text-center text-xs text-slate-500">{t("muse.accountSearchEmpty")}</p>}
          </div>
          <div className="shrink-0 border-t border-slate-200 bg-white/80 px-4 py-3 text-[11px] text-slate-500">
            {pool ? t("muse.poolCount", { signedIn: loggedInCount, ready: readyCount, unchecked: pool.accounts.length - Object.keys(statuses).length, total: pool.accounts.length }) : t("muse.poolHint")}
          </div>
        </aside>}
        <main className="min-w-0 flex-1" aria-label={activeAccount?.name || t("muse.workspaceTitle")} />
      </div>
      {accountContextMenu && createPortal(
        <div
          ref={accountContextMenuRef}
          role="group"
          aria-label={t("nav.more")}
          onContextMenu={event => event.preventDefault()}
          className="fixed z-[9999] w-52 max-w-[calc(100vw_-_1rem)] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-xl"
          style={{ left: Math.max(8, Math.min(accountContextMenu.x, window.innerWidth - 216)), top: Math.max(8, Math.min(accountContextMenu.y, window.innerHeight - 96)) }}
        >
          <button type="button" disabled={busy || queueBusy || cleanupOpen || !!editingAccount || !!removingAccount} onClick={() => { const account = accountContextMenu.account; setAccountContextMenu(null); editAccount(account); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40">
            <Pencil className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t("muse.accountEdit", { name: accountContextMenu.account.name })}
          </button>
          <button type="button" disabled={busy || queueBusy || cleanupOpen || !!editingAccount || !!removingAccount || (cleanupInProgress && accountContextMenu.account.id === cleanupProcessingAccountId) || (pool?.accounts.length || 0) <= 1} title={(pool?.accounts.length || 0) <= 1 ? t("muse.accountKeepOne") : t("muse.accountRemove", { name: accountContextMenu.account.name })} onClick={() => { const account = accountContextMenu.account; setAccountContextMenu(null); setRemovingAccount(account); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-40">
            <Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t("muse.accountRemove", { name: accountContextMenu.account.name })}
          </button>
        </div>,
        document.body,
      )}
      {editingAccount && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/30 p-4">
          <form role="dialog" aria-modal="true" aria-labelledby="muse-account-edit-title" onSubmit={event => { event.preventDefault(); void saveAccount(); }} className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl" style={{ colorScheme: "light" }}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 id="muse-account-edit-title" className="text-base font-semibold">{t("muse.accountEditTitle")}</h2>
                <p className="mt-1 text-xs text-slate-500">{editingAccount.name}</p>
              </div>
              <button type="button" aria-label={t("muse.accountCancel")} disabled={busy} onClick={() => setEditingAccount(undefined)} className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-50"><X className="h-4 w-4" aria-hidden="true" /></button>
            </div>
            <label className="mb-3 block text-xs font-medium text-slate-700">
              {t("muse.accountName")}
              <input autoFocus maxLength={40} required value={editName} onChange={event => setEditName(event.target.value)} className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 caret-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus-visible:outline-blue-500" />
            </label>
            <label className="block text-xs font-medium text-slate-700">
              {t("muse.accountNote")}
              <input maxLength={160} value={editNote} onChange={event => setEditNote(event.target.value)} className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 caret-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus-visible:outline-blue-500" />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" disabled={busy} onClick={() => setEditingAccount(undefined)} className="h-9 rounded-md border border-slate-300 px-3 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">{t("muse.accountCancel")}</button>
              <button type="submit" disabled={busy || !editName.trim()} className="inline-flex h-9 items-center rounded-md bg-blue-600 px-3 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-label={t("muse.statusChecking")} /> : t("muse.accountSave")}</button>
            </div>
          </form>
        </div>
      )}
      {removingAccount && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/30 p-4">
          <section role="alertdialog" aria-modal="true" aria-labelledby="muse-account-remove-title" className="w-full max-w-md rounded-xl border border-rose-200 bg-white p-5 shadow-xl">
            <h2 id="muse-account-remove-title" className="text-base font-semibold">{t("muse.accountRemoveTitle", { name: removingAccount.name })}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{t("muse.accountRemoveBody")}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" disabled={busy} onClick={() => setRemovingAccount(undefined)} className="h-9 rounded-md border border-slate-300 px-3 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">{t("muse.accountCancel")}</button>
              <button type="button" disabled={busy || queueBusy || (pool?.accounts.length || 0) <= 1} onClick={() => void removeAccount()} className="h-9 rounded-md bg-rose-600 px-3 text-xs font-medium text-white hover:bg-rose-500 disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-label={t("muse.statusChecking")} /> : t("muse.accountRemoveConfirm")}</button>
            </div>
          </section>
        </div>
      )}
      {cleanupOpen && activeAccount && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-slate-900/30 p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="muse-cleanup-title" className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl" style={{ colorScheme: "light" }}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="muse-cleanup-title" className="text-base font-semibold">{t("muse.cleanupTitle")}</h2>
                <p className="mt-1 text-xs text-slate-500">{activeAccount.name}</p>
              </div>
              <button type="button" aria-label={t("muse.accountCancel")} disabled={cleanupLoading} onClick={closeCleanup} className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-50"><X className="h-4 w-4" aria-hidden="true" /></button>
            </div>
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">{t("muse.cleanupDescription")}</div>
            {accountCleanupSchedules.length > 0 && <details className="mt-3 text-xs">
              <summary className="cursor-pointer font-medium text-slate-600">{t("muse.cleanupScheduledCount", { count: accountCleanupSchedules.length })}</summary>
              <div className="mt-2 divide-y divide-slate-100">
                {accountCleanupSchedules.map(task => <div key={task.id} className="flex items-start gap-3 py-2">
                  <div className="min-w-0 flex-1 text-slate-600">
                    <p>{task.repeatEveryDays
                      ? t("muse.cleanupRepeatTask", { days: task.repeatEveryDays, excluded: task.excludedChatIds?.length || 0, time: new Date(task.dueAtMs).toLocaleString() })
                      : t("muse.cleanupScheduleTask", { count: task.chats.length, time: new Date(task.dueAtMs).toLocaleString() })}</p>
                    {task.error && <p className="mt-1 break-words text-rose-700">{task.error}</p>}
                  </div>
                  {task.error && (!task.repeatEveryDays || task.identityScheme === 2) &&
                    <button type="button" disabled={cleanupLoading || !!cleanupScheduleProcessing || queueBusy} onClick={() => void resumeScheduledCleanup(task)} className="shrink-0 text-blue-700 hover:text-blue-800 disabled:opacity-40">{t("muse.cleanupScheduleResume")}</button>}
                  <button type="button" disabled={cleanupLoading || cleanupScheduleProcessing === task.id} onClick={() => void cancelScheduledCleanup(task.id)} className="shrink-0 text-rose-700 hover:text-rose-800 disabled:opacity-40">{t("muse.cleanupScheduleCancel")}</button>
                </div>)}
              </div>
            </details>}
            <div role="group" aria-label={t("muse.cleanupModeLabel")} className="mt-4 flex rounded-lg bg-slate-100 p-1 text-xs">
              <button type="button" aria-pressed={cleanupMode === "once"} onClick={() => setCleanupMode("once")} className={`flex-1 rounded-md px-3 py-2 ${cleanupMode === "once" ? "bg-white font-medium text-slate-900 shadow-sm" : "text-slate-600"}`}>{t("muse.cleanupModeOnce")}</button>
              <button type="button" aria-pressed={cleanupMode === "repeat"} onClick={() => setCleanupMode("repeat")} className={`flex-1 rounded-md px-3 py-2 ${cleanupMode === "repeat" ? "bg-white font-medium text-slate-900 shadow-sm" : "text-slate-600"}`}>{t("muse.cleanupModeRepeat")}</button>
            </div>
            <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
              {cleanupLoading ? (
                <div className="flex h-48 items-center justify-center gap-2 text-sm text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />{t("muse.cleanupLoading")}</div>
              ) : cleanupChats.length === 0 ? (
                <p role={cleanupError ? "alert" : undefined} className={`px-4 py-10 text-center text-sm ${cleanupError ? "text-rose-700" : "text-slate-500"}`}>{cleanupError || t("muse.cleanupEmpty")}</p>
              ) : (
                <>
                  <label className="flex h-10 items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700">
                    <input type="checkbox"
                      className="h-4 w-4 shrink-0 accent-blue-600"
                      checked={cleanupMode === "once" ? allChatsSelected : allRecurringExclusionsSelected}
                      disabled={cleanupMode === "once" ? !selectableChats.length : !recurringExclusionCandidates.length}
                      onChange={() => cleanupMode === "once"
                        ? setSelectedChats(allChatsSelected ? new Set() : new Set(selectableChats.slice(0, cleanupSelectionLimit).map(chat => chat.id)))
                        : setExcludedChatIds(allRecurringExclusionsSelected ? new Set() : new Set(recurringExclusionCandidates.map(chat => chat.id)))} />
                    {cleanupMode === "once"
                      ? t("muse.cleanupSelectAll", { count: Math.min(cleanupSelectionLimit, selectableChats.length) })
                      : t("muse.cleanupExcludeAll", { count: recurringExclusionCandidates.length })}
                    <span className="ml-auto text-slate-500">{cleanupMode === "once"
                      ? t("muse.cleanupSelected", { count: selectedChats.size })
                      : t("muse.cleanupExcludedCount", { count: excludedChatIds.size })}</span>
                  </label>
                  <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto">
                    {cleanupChats.map(chat => (
                      <label key={chat.id} className={`flex min-h-10 items-center gap-2 px-3 py-2 text-sm ${chat.ambiguous ? "bg-slate-50 text-slate-400" : "text-slate-800 hover:bg-slate-50"}`} title={chat.title}>
                        <input type="checkbox"
                          className="h-4 w-4 shrink-0 accent-blue-600 disabled:cursor-not-allowed"
                          checked={cleanupMode === "once" ? selectedChats.has(chat.id) : excludedChatIds.has(chat.id)}
                          disabled={cleanupLoading || chat.ambiguous || (cleanupMode === "once" && selectedChats.size >= cleanupSelectionLimit && !selectedChats.has(chat.id))}
                          onChange={() => cleanupMode === "once"
                            ? setSelectedChats(current => { const next = new Set(current); if (next.has(chat.id)) next.delete(chat.id); else next.add(chat.id); return next; })
                            : setExcludedChatIds(current => { const next = new Set(current); if (next.has(chat.id)) next.delete(chat.id); else next.add(chat.id); return next; })} />
                        <span className="min-w-0 flex-1 truncate">{chat.title}</span>
                        {chat.ambiguous && <span className="shrink-0 text-[11px]">{t("muse.cleanupAmbiguous")}</span>}
                        {cleanupMode === "repeat" && !chat.stable && !chat.ambiguous && <span className="shrink-0 text-[11px]">{t("muse.cleanupTitleFallback")}</span>}
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
            {cleanupMode === "once" && selectedChats.size > 0 && <details className="mt-4 border-t border-slate-200 pt-3">
              <summary className="cursor-pointer text-xs font-medium text-blue-700">{t("muse.cleanupScheduleSelected", { count: selectedChats.size })}</summary>
              <div className="mt-2 space-y-2">
                <p className="text-xs leading-5 text-slate-500">{t("muse.cleanupScheduleHint")}</p>
                <label className="block text-xs font-medium text-slate-700">{t("muse.cleanupScheduleAt")}
                  <input type="datetime-local" required min={localDateTimeInput(1)} value={cleanupDueAt} onChange={event => setCleanupDueAt(event.target.value)} className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
                </label>
                <button type="button" disabled={cleanupLoading || !selectedChats.size} onClick={() => void scheduleSelectedChats()} className="h-9 rounded-md bg-blue-600 px-3 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50">{t("muse.cleanupScheduleButton", { count: selectedChats.size })}</button>
              </div>
            </details>}
            {cleanupMode === "repeat" && <div className="mt-4 space-y-3 rounded-lg border border-slate-200 p-3">
              <p className="text-xs leading-5 text-slate-600">{t("muse.cleanupRepeatDescription", { days: cleanupRepeatDays, count: recurringIncludeCount })}</p>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-medium text-slate-700">{t("muse.cleanupRepeatEveryDays")}
                  <input type="number" min={1} max={365} step={1} value={cleanupRepeatDays} onChange={event => setCleanupRepeatDays(event.target.value)} className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
                </label>
                <label className="block text-xs font-medium text-slate-700">{t("muse.cleanupRepeatFirstAt")}
                  <input type="datetime-local" required min={localDateTimeInput(1)} value={cleanupRepeatDueAt} onChange={event => setCleanupRepeatDueAt(event.target.value)} className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
                </label>
              </div>
              <p className="text-xs text-slate-500">{t("muse.cleanupExcludedCount", { count: excludedChatIds.size })}</p>
              {accountRecurringCleanup && <p className="text-xs text-amber-700">{t("muse.cleanupRepeatExists")}</p>}
              <button type="button" disabled={cleanupLoading || !!accountRecurringCleanup || Number(cleanupRepeatDays) < 1 || Number(cleanupRepeatDays) > 365 || !Number.isInteger(Number(cleanupRepeatDays))} onClick={scheduleRecurringCleanup} className="h-9 rounded-md bg-blue-600 px-3 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50">{t("muse.cleanupRepeatButton")}</button>
            </div>}
            {cleanupError && (cleanupChats.length > 0 || cleanupMode === "repeat") && <p role="alert" className="mt-3 text-xs text-rose-700">{cleanupError}</p>}
            <div className="mt-4 border-t border-slate-200 pt-3">
              <button type="button" onClick={() => setResetHelpOpen(value => !value)} className="text-xs font-medium text-rose-700 hover:text-rose-800">{t("muse.resetAdvanced")}</button>
              {resetHelpOpen && <p className="mt-2 rounded-md bg-rose-50 p-3 text-xs leading-5 text-rose-900">{t("muse.resetWarning")}</p>}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" disabled={cleanupLoading} onClick={closeCleanup} className="h-9 rounded-md border border-slate-300 px-3 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">{t("muse.accountCancel")}</button>
              {cleanupMode === "once" && <button type="button" disabled={cleanupLoading || selectedChats.size === 0} onClick={() => setConfirmCleanup(true)} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-rose-600 px-3 text-xs font-medium text-white hover:bg-rose-500 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" />{t("muse.cleanupConfirmButton", { count: selectedChats.size })}</button>}
            </div>
          </section>
          {confirmCleanup && (
            <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
              <section role="alertdialog" aria-modal="true" aria-labelledby="muse-cleanup-confirm-title" className="w-full max-w-md rounded-xl border border-rose-200 bg-white p-5 shadow-2xl">
                <h3 id="muse-cleanup-confirm-title" className="text-base font-semibold text-slate-900">{t("muse.cleanupConfirmTitle", { count: selectedChats.size })}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{t("muse.cleanupConfirmBody", { count: selectedChats.size, account: activeAccount.name })}</p>
                <div className="mt-4 max-h-36 overflow-y-auto rounded-md bg-slate-50 p-3 text-xs text-slate-600">
                  {cleanupChats.filter(chat => selectedChats.has(chat.id)).map(chat => <div key={chat.id} className="truncate">• {chat.title}</div>)}
                </div>
                <div className="mt-5 flex justify-end gap-2">
                  <button type="button" disabled={cleanupLoading} onClick={() => setConfirmCleanup(false)} className="h-9 rounded-md border border-slate-300 px-3 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">{t("muse.accountCancel")}</button>
                  <button type="button" disabled={cleanupLoading} onClick={() => void deleteSelectedChats()} className="h-9 rounded-md bg-rose-600 px-3 text-xs font-medium text-white hover:bg-rose-500 disabled:opacity-50">{t("muse.cleanupDeleteNow")}</button>
                </div>
              </section>
            </div>
          )}
          {confirmRepeatCleanup && (
            <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
              <section role="alertdialog" aria-modal="true" aria-labelledby="muse-cleanup-repeat-confirm-title" className="w-full max-w-md rounded-xl border border-rose-200 bg-white p-5 shadow-2xl">
                <h3 id="muse-cleanup-repeat-confirm-title" className="text-base font-semibold text-slate-900">{t("muse.cleanupRepeatConfirmTitle")}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{t("muse.cleanupRepeatConfirmBody", { account: activeAccount.name, days: cleanupRepeatDays, count: recurringIncludeCount, excluded: excludedChatIds.size })}</p>
                <div className="mt-5 flex justify-end gap-2">
                  <button type="button" disabled={cleanupLoading} onClick={() => setConfirmRepeatCleanup(false)} className="h-9 rounded-md border border-slate-300 px-3 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">{t("muse.accountCancel")}</button>
                  <button type="button" disabled={cleanupLoading} onClick={() => void confirmRecurringCleanup()} className="h-9 rounded-md bg-rose-600 px-3 text-xs font-medium text-white hover:bg-rose-500 disabled:opacity-50">{t("muse.cleanupRepeatConfirmButton")}</button>
                </div>
              </section>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
