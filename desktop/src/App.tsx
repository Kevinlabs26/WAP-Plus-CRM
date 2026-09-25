import {
  lazy,
  memo,
  Suspense,
  useEffect,
  useDeferredValue,
  useState,
  type ComponentType,
} from "react";
import { TopBar } from "@/components/layout/TopBar";
import { StatsBar } from "@/components/layout/StatsBar";
import { ConfirmHost } from "@/components/ui/ConfirmHost";
import { ToastHost } from "@/components/ui/ToastHost";
import { UpdateWatcher } from "@/components/bridge/UpdateWatcher";
import { UpdateCompleteModal } from "@/components/UpdateCompleteModal";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { BootSplash } from "@/components/BootSplash";
import { useI18n } from "@/i18n";
import { ChatWelcome } from "@/components/chat/ChatWelcome";
import { VoicePlaybackHost } from "@/components/chat/VoiceBubble";
import { useAppStore } from "@/store/appStore";
import { flushPersist, primePersistBaseline } from "@/store/persist";
import { setBaileysAccountIdResolver } from "@/lib/baileys";
import {
  getRecentMainThreadWork,
  installSyncDebugGlobals,
  installSyncPerformanceProbe,
  noteUiWorkTrigger,
  startTypingDiagnostics,
  syncLog,
} from "@/lib/syncDebug";
import {
  isComposerInputActive,
  isComposerInputFocused,
} from "@/lib/composerActivity";

/* -------------------------------------------------------------------------- */
/*  Lazy 重模块：启动闪屏阶段不解析 ChatPanel / Sidebar / 各业务页              */
/* -------------------------------------------------------------------------- */

const PhoneSidebar = lazy(() =>
  import("@/components/layout/PhoneSidebar").then((m) => ({
    default: m.PhoneSidebar,
  }))
);
const loadChatPanel = () =>
  import("@/components/chat/ChatPanel").then((m) => ({
    default: m.ChatPanel,
  }));
const ChatPanel = lazy(loadChatPanel);
const CrmAiPanel = lazy(() =>
  import("@/components/crm/CrmAiPanel").then((m) => ({
    default: m.CrmAiPanel,
  }))
);
const StarredView = lazy(() =>
  import("@/components/views/StarredView").then((m) => ({
    default: m.StarredView,
  }))
);
const StatsView = lazy(() =>
  import("@/components/views/StatsView").then((m) => ({
    default: m.StatsView,
  }))
);
const AccountMonitorView = lazy(() =>
  import("@/components/views/AccountMonitorView").then((m) => ({
    default: m.AccountMonitorView,
  }))
);
const PhonesView = lazy(() =>
  import("@/components/views/PhonesView").then((m) => ({
    default: m.PhonesView,
  }))
);
const CrmView = lazy(() =>
  import("@/components/views/CrmView").then((m) => ({
    default: m.CrmView,
  }))
);
const SettingsModal = lazy(() =>
  import("@/components/settings/SettingsModal").then((m) => ({
    default: m.SettingsModal,
  }))
);
const BaileysLoginModal = lazy(() =>
  import("@/components/settings/BaileysLoginModal").then((m) => ({
    default: m.BaileysLoginModal,
  }))
);
const CommandPalette = lazy(() =>
  import("@/components/CommandPalette").then((m) => ({
    default: m.CommandPalette,
  }))
);
const BridgeWatcher = lazy(() =>
  import("@/components/bridge/BridgeWatcher").then((m) => ({
    default: m.BridgeWatcher,
  }))
);
const BaileysWatcher = lazy(() =>
  import("@/components/bridge/BaileysWatcher").then((m) => ({
    default: m.BaileysWatcher,
  }))
);
const SendQueueWatcher = lazy(() =>
  import("@/components/bridge/SendQueueWatcher").then((m) => ({
    default: m.SendQueueWatcher,
  }))
);
const CampaignRunner = lazy(() =>
  import("@/components/bridge/CampaignRunner").then((m) => ({
    default: m.CampaignRunner,
  }))
);
const BroadcastView = lazy(() =>
  import("@/components/views/BroadcastView").then((m) => ({
    default: m.BroadcastView,
  }))
);const TodayView = lazy(() =>
  import("@/components/views/TodayView").then((m) => ({
    default: m.TodayView,
  }))
);
const FollowUpDueWatcher = lazy(() =>
  import("@/components/bridge/FollowUpDueWatcher").then((m) => ({
    default: m.FollowUpDueWatcher,
  }))
);
const ScheduledMessageWatcher = lazy(() =>
  import("@/components/bridge/ScheduledMessageWatcher").then((m) => ({
    default: m.ScheduledMessageWatcher,
  }))
);
const GroupAutoReadWatcher = lazy(() =>
  import("@/components/bridge/GroupAutoReadWatcher").then((m) => ({
    default: m.GroupAutoReadWatcher,
  }))
);

type MainNavPageId =
  | "today"
  | "phones"
  | "crm"
  | "broadcast"
  | "starred"
  | "stats"
  | "monitor";

const MAIN_NAV_PAGES: Record<
  MainNavPageId,
  { Page: ComponentType; label: string }
> = {
  today: { Page: TodayView, label: "工作台" },
  phones: { Page: PhonesView, label: "设备" },
  crm: { Page: CrmView, label: "客户库" },
  broadcast: { Page: BroadcastView, label: "群发" },
  starred: { Page: StarredView, label: "星标" },
  stats: { Page: StatsView, label: "统计" },
  monitor: { Page: AccountMonitorView, label: "监测" },
};

const KeepAliveNavPage = memo(function KeepAliveNavPage({
  active,
  Page,
  label,
  onRetry,
}: {
  active: boolean;
  Page: ComponentType;
  label: string;
  onRetry: () => void;
}) {
  return (
    <div hidden={!active} className={active ? "contents" : undefined} aria-hidden={!active}>
      <ErrorBoundary label={label} onRetry={onRetry}>
        <Suspense fallback={<PanelFallback />}>
          <Page />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
});

const KeepAliveChats = memo(function KeepAliveChats({
  active,
  interactive,
}: {
  active: boolean;
  interactive: boolean;
}) {
  return (
    <div hidden={!active} className={active ? "contents" : undefined} aria-hidden={!active}>
      <ErrorBoundary label="会话列表">
        <Suspense fallback={<SidebarSkeleton />}>
          <PhoneSidebar />
        </Suspense>
      </ErrorBoundary>
      <ErrorBoundary label="聊天">
        <ChatsMain />
      </ErrorBoundary>
      <DeferredCrmPanel interactive={interactive} />
    </div>
  );
});
const AiAutoReplier = lazy(() =>
  import("@/components/bridge/AiAutoReplier").then((m) => ({
    default: m.AiAutoReplier,
  }))
);

/** 多号轮询降载（进主界面后） */
const BOOT_GRACE_MS = 1200;
/** 可交互后再延迟挂 Watcher */
const WATCHER_AFTER_READY_MS = 4500;
const POST_HYDRATE_MS = 0;
const SPLASH_EXIT_MS = 180;
const EARLY_SHELL_MS = 350;
/** CRM / 弹层延后 */
const CRM_MOUNT_DELAY_MS = 900;
/** idle 等待上限，避免极忙机器永不揭盖 */
const IDLE_WAIT_MAX_MS = 350;
const IDLE_QUIET_MS = 16;
let startupHydratePromise: Promise<void> | null = null;

function hydrateOnce(hydrate: () => Promise<void>) {
  if (!startupHydratePromise) {
    startupHydratePromise = hydrate().catch((error) => {
      startupHydratePromise = null;
      throw error;
    });
  }
  return startupHydratePromise;
}

function waitFrames(n: number) {
  return new Promise<void>((resolve) => {
    let left = n;
    const step = () => {
      left -= 1;
      if (left <= 0) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function waitMs(ms: number) {
  return new Promise<void>((r) => window.setTimeout(r, ms));
}

/** 连续安静帧或 timeout，比写死 1.4s 更贴机器 */
function waitForMainThreadIdle(options?: {
  maxMs?: number;
  quietMs?: number;
  minFrames?: number;
}) {
  const maxMs = options?.maxMs ?? IDLE_WAIT_MAX_MS;
  const quietMs = options?.quietMs ?? IDLE_QUIET_MS;
  const minFrames = options?.minFrames ?? 3;

  return new Promise<void>((resolve) => {
    const started = performance.now();
    let quietStreak = 0;
    let raf = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (raf) cancelAnimationFrame(raf);
      resolve();
    };
    const hardCap = window.setTimeout(finish, maxMs);

    const ric = (
      window as unknown as {
        requestIdleCallback?: (
          cb: () => void,
          opts?: { timeout: number }
        ) => number;
      }
    ).requestIdleCallback;

    if (typeof ric === "function") {
      ric(
        () => {
          window.clearTimeout(hardCap);
          // idle 后再确认 2 帧
          requestAnimationFrame(() =>
            requestAnimationFrame(() => finish())
          );
        },
        { timeout: maxMs }
      );
      return;
    }

    let last = performance.now();
    const tick = (now: number) => {
      const frame = now - last;
      last = now;
      if (frame <= quietMs) quietStreak += 1;
      else quietStreak = 0;
      if (
        quietStreak >= minFrames ||
        now - started >= maxMs
      ) {
        window.clearTimeout(hardCap);
        finish();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  });
}

function preloadLazy(
  factories: Array<() => Promise<{ default: ComponentType<unknown> }>>
) {
  for (const f of factories) {
    void f().catch(() => undefined);
  }
}

function useBootGraceClass(interactive: boolean) {
  useEffect(() => {
    if (!interactive) return;
    const root = document.body;
    root.classList.add("app-booting");
    (window as unknown as { __wapBootUntil?: number }).__wapBootUntil =
      Date.now() + BOOT_GRACE_MS;
    const t = window.setTimeout(() => {
      root.classList.remove("app-booting");
      delete (window as unknown as { __wapBootUntil?: number }).__wapBootUntil;
    }, BOOT_GRACE_MS);
    return () => {
      window.clearTimeout(t);
      root.classList.remove("app-booting");
      delete (window as unknown as { __wapBootUntil?: number }).__wapBootUntil;
    };
  }, [interactive]);
}

function useWindowInteractionClass() {
  useEffect(() => {
    const root = document.body;
    let clearTimer: number | null = null;
    let markRaf = 0;
    const mark = () => {
      if (markRaf) return;
      markRaf = window.requestAnimationFrame(() => {
        markRaf = 0;
        if (!root.classList.contains("app-window-interacting")) {
          root.classList.add("app-window-interacting");
        }
        if (clearTimer != null) window.clearTimeout(clearTimer);
        clearTimer = window.setTimeout(() => {
          root.classList.remove("app-window-interacting");
          clearTimer = null;
        }, 200);
      });
    };
    window.addEventListener("resize", mark, { passive: true });
    return () => {
      window.removeEventListener("resize", mark);
      if (clearTimer != null) window.clearTimeout(clearTimer);
      if (markRaf) window.cancelAnimationFrame(markRaf);
      root.classList.remove("app-window-interacting");
    };
  }, []);
}

function SidebarSkeleton() {
  return (
    <aside className="flex w-[min(100%,20rem)] shrink-0 flex-col border-r border-zinc-800/90 bg-zinc-950">
      <div className="border-b border-zinc-800/80 p-3">
        <div className="h-8 animate-pulse rounded-lg bg-zinc-900" />
      </div>
      <div className="flex flex-col gap-2 p-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-zinc-900" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="h-3 w-2/3 animate-pulse rounded bg-zinc-900" />
              <div className="h-2.5 w-full animate-pulse rounded bg-zinc-900/70" />
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

function PanelFallback({ className }: { className?: string }) {
  return (
    <div
      className={
        "flex min-h-0 flex-1 items-center justify-center bg-zinc-950 " +
        (className || "")
      }
    >
      <div className="h-8 w-8 animate-pulse rounded-lg bg-brand/20" />
    </div>
  );
}

function DeferredWatchers({ interactive }: { interactive: boolean }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!interactive) {
      setReady(false);
      return;
    }
    let t: number;
    const mount = () => {
      if (isComposerInputActive()) {
        t = window.setTimeout(mount, 300);
        return;
      }
      setReady(true);
    };
    t = window.setTimeout(mount, WATCHER_AFTER_READY_MS);
    return () => window.clearTimeout(t);
  }, [interactive]);
  if (!ready) return null;
  return (
    <Suspense fallback={null}>
      <BridgeWatcher />
      <BaileysWatcher />
      <SendQueueWatcher />
      <CampaignRunner />
      <ScheduledMessageWatcher />
      <FollowUpDueWatcher />
      <GroupAutoReadWatcher />
      <AiAutoReplier />
      <UpdateWatcher />
    </Suspense>
  );
}

function DeferredCrmPanel({ interactive }: { interactive: boolean }) {
  const crmPanelCollapsed = useAppStore((s) => s.crmPanelCollapsed);
  const hasSelection = useAppStore(
    (s) => Boolean(s.selectedChatId || s.selectedContactId)
  );
  const compact = crmPanelCollapsed || !hasSelection;
  const placeholderClass = compact
    ? "hidden w-11 shrink-0 border-l border-zinc-800/80 bg-zinc-950 lg:block"
    : "hidden w-[min(100%,22rem)] shrink-0 border-l border-zinc-800/80 bg-zinc-900 lg:block";
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!interactive) {
      setShow(false);
      return;
    }
    const t = window.setTimeout(() => setShow(true), CRM_MOUNT_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [interactive]);
  if (compact) return null;
  if (!show) {
    return <aside className={placeholderClass} />;
  }
  return (
    <Suspense
      fallback={<aside className={placeholderClass} />}
    >
      <CrmAiPanel />
    </Suspense>
  );
}

function DeferredModals({ interactive }: { interactive: boolean }) {
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const baileysLoginOpen = useAppStore((s) => s.baileysLoginOpen);
  const commandOpen = useAppStore((s) => s.commandOpen);
  const setCommandOpen = useAppStore((s) => s.setCommandOpen);

  useEffect(() => {
    if (!interactive) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(!useAppStore.getState().commandOpen);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [interactive, setCommandOpen]);

  if (!interactive || (!settingsOpen && !baileysLoginOpen && !commandOpen)) {
    return null;
  }
  return (
    <Suspense fallback={null}>
      {settingsOpen ? <SettingsModal /> : null}
      {baileysLoginOpen ? <BaileysLoginModal /> : null}
      {commandOpen ? <CommandPalette /> : null}
    </Suspense>
  );
}

/**
 * 聊天主区：无选中会话只用轻量 Welcome；选中后再 lazy ChatPanel。
 * 进房瞬间不付 3.8k 行 ChatPanel 首解析（若 chunk 已 preload 则很快）。
 */
function ChatsMain() {
  const selectedChatId = useAppStore((s) => s.selectedChatId);
  if (!selectedChatId) {
    return <ChatWelcome />;
  }
  return (
    <Suspense fallback={<PanelFallback />}>
      <ChatPanel />
    </Suspense>
  );
}

function NavBody({ interactive }: { interactive: boolean }) {
  const activeNav = useAppStore((s) => s.activeNav);
  const setActiveNav = useAppStore((s) => s.setActiveNav);
  const renderedNav = useDeferredValue(activeNav);
  const [visitedNav, setVisitedNav] = useState(
    () => new Set<MainNavPageId | "chats">([activeNav])
  );

  useEffect(() => {
    setVisitedNav((current) => {
      if (current.has(renderedNav)) return current;
      return new Set(current).add(renderedNav);
    });
    syncLog("ui.nav", "content rendered", { nav: renderedNav }, "debug");
  }, [renderedNav]);

  return (
    <>
      {(visitedNav.has("chats") || renderedNav === "chats") && (
        <KeepAliveChats
          active={renderedNav === "chats"}
          interactive={interactive}
        />
      )}
      {(Object.entries(MAIN_NAV_PAGES) as [MainNavPageId, (typeof MAIN_NAV_PAGES)[MainNavPageId]][]).map(
        ([id, config]) =>
          visitedNav.has(id) || renderedNav === id ? (
            <KeepAliveNavPage
              key={id}
              active={renderedNav === id}
              Page={config.Page}
              label={config.label}
              onRetry={() => setActiveNav("chats")}
            />
          ) : null
      )}
    </>
  );
}

export default function App() {
  const { t } = useI18n();
  const activeNav = useAppStore((s) => s.activeNav);
  const hydrate = useAppStore((s) => s.hydrate);
  const hydrated = useAppStore((s) => s.hydrated);
  const setUiReady = useAppStore((s) => s.setUiReady);

  const [progress, setProgress] = useState(6);
  const [bootLabel, setBootLabel] = useState(t("app.starting"));
  /** 轻壳已挂（TopBar + 侧栏 lazy + Welcome） */
  const [shellMounted, setShellMounted] = useState(false);
  const [interactive, setInteractive] = useState(false);
  const [splashExiting, setSplashExiting] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  /** 启动期数据加载失败：阻断进入空库界面，避免「看似正常实则全空」的静默数据丢失 */
  const [bootFatal, setBootFatal] = useState<string | null>(null);

  useEffect(() => {
    if (activeNav !== "phones") return;
    window.dispatchEvent(new Event("wap:refresh-account-status"));
  }, [activeNav]);

  useWindowInteractionClass();
  useBootGraceClass(interactive);

  useEffect(() => {
    let lastExitFlushAt = 0;
    const flushBeforePageExit = () => {
      // Tauri 关闭主窗口默认只是隐藏，不一定触发 pagehide；隐藏时先抢救一次快照。
      if (Date.now() - lastExitFlushAt < 500) return;
      lastExitFlushAt = Date.now();
      const state = useAppStore.getState();
      if (state.hydrated) flushPersist(() => useAppStore.getState());
    };
    const saveWhenHidden = () => {
      if (document.visibilityState === "hidden") flushBeforePageExit();
    };
    window.addEventListener("pagehide", flushBeforePageExit);
    document.addEventListener("visibilitychange", saveWhenHidden);
    return () => {
      window.removeEventListener("pagehide", flushBeforePageExit);
      document.removeEventListener("visibilitychange", saveWhenHidden);
    };
  }, []);

  useEffect(() => {
    const preventBrowserContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };
    window.addEventListener("contextmenu", preventBrowserContextMenu);
    return () =>
      window.removeEventListener("contextmenu", preventBrowserContextMenu);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (useAppStore.getState().settings.theme === "light") {
      root.dataset.theme = "light";
    } else {
      delete root.dataset.theme;
    }
  }, [hydrated]);

  useEffect(() => {
    const unsubscribe = useAppStore.subscribe((state, prev) => {
      const cur = state.settings.theme;
      const prevTheme = prev.settings.theme;
      if (cur === prevTheme) return;
      const root = document.documentElement;
      if (cur === "light") root.dataset.theme = "light";
      else delete root.dataset.theme;
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const bootStarted = performance.now();
    let cancelled = false;
    let tickTimer: number | null = null;
    const earlyShellTimer = window.setTimeout(() => {
      if (cancelled) return;
      setShellMounted(true);
      console.info(
        `[startup] early-shell ${(performance.now() - bootStarted).toFixed(0)}ms`
      );
      setSplashExiting(true);
      window.setTimeout(() => {
        if (!cancelled) setShowSplash(false);
      }, SPLASH_EXIT_MS);
    }, EARLY_SHELL_MS);

    installSyncDebugGlobals();
    startTypingDiagnostics();
    const stopSyncPerformanceProbe = installSyncPerformanceProbe(() => {
      const state = useAppStore.getState();
      const chat = state.chats.find((item) => item.id === state.selectedChatId);
      const recentWork = getRecentMainThreadWork();
      return {
        typingActive: isComposerInputActive(),
        inputFocused: isComposerInputFocused(),
        messages: state.messages.length,
        contacts: state.contacts.length,
        chats: state.chats.length,
        recentWorkName: recentWork?.name,
        recentWorkDurationMs: recentWork?.durationMs,
        accountId:
          state.selectedThreadAccount?.accountId || chat?.accountId || null,
      };
    });
    const stopStoreProbe = useAppStore.subscribe((state, previous) => {
      if (!isComposerInputActive()) return;
      const changed = [
        state.contacts !== previous.contacts && "contacts",
        state.chats !== previous.chats && "chats",
        state.messages !== previous.messages && "messages",
        state.messagesByChatId !== previous.messagesByChatId && "message-index",
        state.settings !== previous.settings && "settings",
        state.baileysUi !== previous.baileysUi && "account-ui",
        state.peerPresenceByKey !== previous.peerPresenceByKey && "presence",
        state.stats !== previous.stats && "stats",
      ].filter(Boolean);
      if (changed.length) noteUiWorkTrigger(`store:${changed.join(",")}`);
    });
    syncLog("app", "sync debug ready — filter console: [wap-sync]");
    setBaileysAccountIdResolver(() => {
      const s = useAppStore.getState().settings;
      return s.liveBaileysAccountId || s.activeAccountId || "wa-default";
    });
    setUiReady(false);

    setBootLabel(t("app.readingData"));
    setProgress(8);

    // 尽早后台拉侧栏 chunk（不挂 ChatPanel，避免抢主线程）
    preloadLazy([
      () =>
        import("@/components/layout/PhoneSidebar").then((m) => ({
          default: m.PhoneSidebar as ComponentType<unknown>,
        })),
    ]);

    const started = Date.now();
    tickTimer = window.setInterval(() => {
      if (cancelled || useAppStore.getState().hydrated) return;
      const elapsed = Date.now() - started;
      setProgress((p) => Math.max(p, Math.min(52, 8 + elapsed / 110)));
    }, 100);

    void (async () => {
      try {
        await hydrateOnce(hydrate);
        primePersistBaseline(() => useAppStore.getState());
      } catch (error) {
        // 数据加载失败绝不能静默继续：persist() 在 hydrated=false 时拒绝写盘，
        // 用户会进入一个看似正常但全空的界面，操作只存内存、关窗即丢。
        console.error("[startup] hydrate failed", error);
        if (tickTimer != null) {
          window.clearInterval(tickTimer);
          tickTimer = null;
        }
        if (!cancelled) {
          setBootFatal(
            t("app.databaseFailed")
          );
        }
        return;
      }
      console.info(
        `[startup] hydrate ${(performance.now() - bootStarted).toFixed(0)}ms`
      );
      if (cancelled) return;
      if (tickTimer != null) {
        window.clearInterval(tickTimer);
        tickTimer = null;
      }

      setBootLabel(t("app.organizingChats"));
      setProgress((p) => Math.max(p, 60));
      await waitFrames(2);
      if (cancelled) return;
      await waitMs(POST_HYDRATE_MS);
      if (cancelled) return;

      // 轻壳：侧栏 + Welcome（无巨型 ChatPanel）
      setBootLabel(t("app.preparingUi"));
      setProgress((p) => Math.max(p, 72));
      setShellMounted(true);
      console.info(
        `[startup] shell ${(performance.now() - bootStarted).toFixed(0)}ms`
      );

      await waitFrames(2);
      if (cancelled) return;
      setProgress((p) => Math.max(p, 86));
      setBootLabel(t("app.entering"));

      // 真 idle，而不是写死 1.4s
      await waitForMainThreadIdle({
        maxMs: IDLE_WAIT_MAX_MS,
        quietMs: IDLE_QUIET_MS,
        minFrames: 3,
      });
      if (cancelled) return;

      setProgress(100);
      setBootLabel(t("app.ready"));
      setUiReady(true);
      console.info(
        `[startup] interactive ${(performance.now() - bootStarted).toFixed(0)}ms`
      );
      // 进主界面后申请一次通知权限（已授权/拒绝则静默）
      if (useAppStore.getState().settings.desktopNotifyEnabled !== false) {
        void import("@/lib/desktopNotify").then((m) =>
          m.ensureNotifyPermission()
        );
      }
      setInteractive(true);
      setSplashExiting(true);
      await waitMs(SPLASH_EXIT_MS);
      if (!cancelled) setShowSplash(false);
    })();

    return () => {
      cancelled = true;
      stopSyncPerformanceProbe();
      stopStoreProbe();
      window.clearTimeout(earlyShellTimer);
      if (tickTimer != null) window.clearInterval(tickTimer);
    };
  }, [hydrate, setUiReady]);

  const showShell = shellMounted;

  return (
    <ErrorBoundary label="应用主界面">
      {showShell && (
        <div
          className={
            "relative flex h-screen min-h-0 flex-col overflow-hidden bg-zinc-950 text-zinc-100 " +
            (showSplash ? "pointer-events-none select-none" : "")
          }
          aria-hidden={showSplash || undefined}
        >
          <TopBar />
          {activeNav !== "today" && <StatsBar />}
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <NavBody interactive={interactive} />
          </div>
          <VoicePlaybackHost />
          <ConfirmHost />
          <ToastHost />
          <DeferredModals interactive={interactive} />
          <DeferredWatchers interactive={interactive} />
        </div>
      )}

      {bootFatal && (
        <div
          className="fixed inset-0 z-[120] flex flex-col items-center justify-center gap-3 bg-zinc-950 px-6 text-center"
          role="alertdialog"
          aria-modal="true"
        >
          <div className="text-[15px] font-semibold text-zinc-100">
            本地数据读取失败
          </div>
          <div className="max-w-md text-[13px] leading-relaxed text-zinc-400">
            {bootFatal}
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2 rounded-lg bg-zinc-100 px-4 py-2 text-[13px] font-medium text-zinc-900 transition-colors hover:bg-white"
          >
            {t("app.retryStartup")}
          </button>
        </div>
      )}

      {showSplash && (
        <BootSplash
          progress={progress}
          label={bootLabel}
          exiting={splashExiting}
        />
      )}

      {!showShell && !showSplash && (
        <div className="flex h-screen items-center justify-center bg-zinc-950 text-[13px] text-zinc-500">
          {t("app.startupFailed")}
        </div>
      )}

      <UpdateCompleteModal ready={interactive} />
    </ErrorBoundary>
  );
}
