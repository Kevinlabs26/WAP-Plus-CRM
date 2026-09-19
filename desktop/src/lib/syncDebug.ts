/**
 * 多账号同步排障日志（默认安静：只入内存缓冲，不刷 Console，避免卡 UI）。
 *
 * 开启控制台输出：
 *   sessionStorage.setItem('wap.syncDebug', '1'); location.reload()
 * 关闭：
 *   sessionStorage.removeItem('wap.syncDebug'); location.reload()
 *
 * 导出：
 *   window.__wapDumpSyncLog()
 * 清空：
 *   window.__wapClearSyncLog()
 */

export type SyncLogLevel = "debug" | "info" | "warn" | "error";

export type SyncLogEntry = {
  t: string;
  level: SyncLogLevel;
  tag: string;
  msg: string;
  data?: unknown;
};

const MAX = 300;
const buf: SyncLogEntry[] = [];
/** 默认关闭：打字诊断的探针/100ms 心跳本身占主线程；`wap.syncDebug=1` 才开启 */
const TYPING_DIAGNOSTICS_ENABLED = (() => {
  try {
    return (
      typeof sessionStorage !== "undefined" &&
      sessionStorage.getItem("wap.syncDebug") === "1"
    );
  } catch {
    return false;
  }
})();
let diagnosticWrite = Promise.resolve();
let recentMainThreadWork:
  | { name: string; durationMs: number; endedAt: number }
  | undefined;

const CONSOLE_ENABLED = (() => {
  try {
    return (
      typeof sessionStorage !== "undefined" &&
      sessionStorage.getItem("wap.syncDebug") === "1"
    );
  } catch {
    return false;
  }
})();

function consoleEnabled(): boolean {
  return CONSOLE_ENABLED;
}

export function isSyncDebugEnabled(): boolean {
  return consoleEnabled();
}

export function isTypingDiagnosticsEnabled(): boolean {
  return TYPING_DIAGNOSTICS_ENABLED;
}

export function noteMainThreadWork(name: string, startedAt: number) {
  const endedAt = performance.now();
  const durationMs = endedAt - startedAt;
  if (durationMs < 16) return;
  recentMainThreadWork = {
    name,
    durationMs: Math.round(durationMs),
    endedAt,
  };
}

export function noteUiWorkTrigger(name: string) {
  recentMainThreadWork = { name, durationMs: 0, endedAt: performance.now() };
}

export function getRecentMainThreadWork() {
  if (!recentMainThreadWork) return undefined;
  if (performance.now() - recentMainThreadWork.endedAt > 2500) return undefined;
  return {
    name: recentMainThreadWork.name,
    durationMs: recentMainThreadWork.durationMs,
  };
}

function ts() {
  const d = new Date();
  return `${d.toISOString().slice(11, 23)}`;
}

export function syncLog(
  tag: string,
  msg: string,
  data?: unknown,
  level: SyncLogLevel = "info"
) {
  const diagnostic =
    TYPING_DIAGNOSTICS_ENABLED &&
    level === "warn" &&
    (tag === "typing" || tag === "main-thread");
  if (!consoleEnabled() && level !== "error" && !diagnostic) return;
  const entry: SyncLogEntry = {
    t: ts(),
    level,
    tag,
    msg,
    data: data === undefined ? undefined : safeClone(data),
  };
  buf.push(entry);
  if (buf.length > MAX) buf.splice(0, buf.length - MAX);

  if (diagnostic) writeTypingDiagnostic(entry);

  // 默认不 console：多号轮询时刷屏会明显拖慢交互
  if (!consoleEnabled() && level !== "error") return;

  const prefix = `[wap-sync][${entry.t}][${tag}]`;
  const line = `${prefix} ${msg}`;
  try {
    if (level === "error") console.error(line, entry.data ?? "");
    else if (level === "warn") console.warn(line, entry.data ?? "");
    else if (level === "debug") console.debug(line, entry.data ?? "");
    else console.info(line, entry.data ?? "");
  } catch {
    /* ignore */
  }
}

function diagnosticLine(entry: SyncLogEntry): string {
  return `${entry.t} [${entry.tag}] ${entry.msg} ${JSON.stringify(entry.data ?? {})}`;
}

function writeTypingDiagnostic(entry: SyncLogEntry, reset = false) {
  diagnosticWrite = diagnosticWrite
    .then(async () => {
      if (!("__TAURI_INTERNALS__" in window)) return;
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("typing_diagnostic_write", {
        line: diagnosticLine(entry),
        reset,
      });
    })
    .catch(() => undefined);
}

export function startTypingDiagnostics() {
  if (typeof window === "undefined" || !TYPING_DIAGNOSTICS_ENABLED) return;
  writeTypingDiagnostic(
    {
      t: ts(),
      level: "info",
      tag: "typing",
      msg: "diagnostics started",
    },
    true
  );
}

export type TypingPerformanceContext = {
  typingActive: boolean;
  inputFocused?: boolean;
  messages: number;
  contacts: number;
  chats: number;
  accountId?: string | null;
  recentWorkName?: string;
  recentWorkDurationMs?: number;
};

export function installSyncPerformanceProbe(
  getContext?: () => TypingPerformanceContext
): () => void {
  if (typeof window === "undefined" || !TYPING_DIAGNOSTICS_ENABLED)
    return () => {};

  let observer: PerformanceObserver | undefined;
  let eventObserver: PerformanceObserver | undefined;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration < 30) continue;
        const context = getContext?.();
        if (context && !context.typingActive) continue;
        syncLog(
          "main-thread",
          "long task",
          {
            durationMs: Math.round(entry.duration),
            startMs: Math.round(entry.startTime),
            ...context,
          },
          "warn"
        );
      }
    });
    observer.observe({ type: "longtask", buffered: true });
  } catch {
    observer = undefined;
  }

  try {
    eventObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!["keydown", "beforeinput", "input"].includes(entry.name))
          continue;
        const event = entry as PerformanceEntry & {
          processingStart: number;
          processingEnd: number;
          interactionId?: number;
        };
        const inputDelayMs = event.processingStart - event.startTime;
        if (inputDelayMs < 30 && event.duration < 60) continue;
        syncLog(
          "typing",
          "browser event latency",
          {
            event: event.name,
            inputDelayMs: Math.round(inputDelayMs),
            processingMs: Math.round(
              event.processingEnd - event.processingStart
            ),
            totalMs: Math.round(event.duration),
            interactionId: event.interactionId,
            ...getContext?.(),
          },
          "warn"
        );
      }
    });
    eventObserver.observe({
      type: "event",
      buffered: true,
      durationThreshold: 16,
    } as PerformanceObserverInit);
  } catch {
    eventObserver = undefined;
  }

  const intervalMs = 100;
  let expectedAt = performance.now() + intervalMs;
  const timer = window.setInterval(() => {
    const now = performance.now();
    const delayMs = now - expectedAt;
    expectedAt = now + intervalMs;
    if (document.hidden || delayMs < 60) return;
    const context = getContext?.();
    if (context && !context.typingActive) return;
    syncLog(
      "main-thread",
      "event loop stall",
      { durationMs: Math.round(delayMs), ...context },
      "warn"
    );
  }, intervalMs);

  return () => {
    observer?.disconnect();
    eventObserver?.disconnect();
    window.clearInterval(timer);
  };
}

function safeClone(v: unknown): unknown {
  try {
    if (v == null) return v;
    if (typeof v !== "object") return v;
    if (Array.isArray(v)) {
      return {
        _type: "array",
        length: v.length,
        head: v.slice(0, 3).map((x) => summarizeItem(x)),
      };
    }
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const [k, val] of Object.entries(o)) {
      if (n++ > 24) {
        out._truncated = true;
        break;
      }
      if (Array.isArray(val)) {
        out[k] = {
          length: val.length,
          head: val.slice(0, 2).map((x) => summarizeItem(x)),
        };
      } else if (val && typeof val === "object") {
        out[k] = "[object]";
      } else {
        out[k] = val;
      }
    }
    return out;
  } catch {
    return String(v);
  }
}

function summarizeItem(x: unknown): unknown {
  if (!x || typeof x !== "object") return x;
  const o = x as Record<string, unknown>;
  return {
    id: o.id,
    jid: o.jid,
    phoneE164: o.phoneE164 ?? o.phone,
    displayName: o.displayName ?? o.name,
    lastMessage:
      typeof o.lastMessage === "string"
        ? String(o.lastMessage).slice(0, 40)
        : undefined,
    accountId: o.accountId,
  };
}

export function getSyncLog(): SyncLogEntry[] {
  return [...buf];
}

export function clearSyncLog() {
  buf.length = 0;
}

export function dumpSyncLogText(): string {
  return buf
    .map((e) => {
      const d =
        e.data === undefined
          ? ""
          : " " +
            (() => {
              try {
                return JSON.stringify(e.data);
              } catch {
                return String(e.data);
              }
            })();
      return `${e.t} [${e.level}] [${e.tag}] ${e.msg}${d}`;
    })
    .join("\n");
}

declare global {
  interface Window {
    __wapDumpSyncLog?: () => string;
    __wapClearSyncLog?: () => void;
    __wapGetSyncLog?: () => SyncLogEntry[];
    __wapEnableSyncDebug?: () => void;
    __wapDisableSyncDebug?: () => void;
  }
}

export function installSyncDebugGlobals() {
  if (typeof window === "undefined") return;
  window.__wapDumpSyncLog = () => {
    const text = dumpSyncLogText();
    console.info(
      `%c[wap-sync] dump ${buf.length} lines`,
      "color:#22c55e;font-weight:bold"
    );
    console.info(text || "(empty)");
    try {
      void navigator.clipboard?.writeText(text);
    } catch {
      /* ignore */
    }
    return text;
  };
  window.__wapClearSyncLog = () => {
    clearSyncLog();
    console.info("[wap-sync] cleared");
  };
  window.__wapGetSyncLog = () => getSyncLog();
  window.__wapEnableSyncDebug = () => {
    sessionStorage.setItem("wap.syncDebug", "1");
    console.info("[wap-sync] console ON — reload required");
  };
  window.__wapDisableSyncDebug = () => {
    sessionStorage.removeItem("wap.syncDebug");
    localStorage.removeItem("wap.syncDebug");
    console.info("[wap-sync] console OFF — reload required");
  };
}
