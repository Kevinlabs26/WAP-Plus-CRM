import type { BridgeEvent } from "./bridge";
import { isComposerTypingBusy } from "./composerActivity.ts";

export function hasRealtimeIngestEvents(events: BridgeEvent[]): boolean {
  return events.some((event) => {
    const payload = event.payload as Record<string, unknown> | undefined;
    if (event.type === "messages.sync") {
      return payload?.live === true || (payload?.live !== false &&
        !["history", "snapshot", "sync"].includes(String(payload?.source || "")));
    }
    if (event.type === "contacts.sync") return payload?.source === "message";
    return ["messages.ack", "messages.delete", "chats.delete"].includes(event.type);
  });
}

/**
 * 实时事件继续接收；历史批次短暂让路，保留 FIFO 顺序并限制最长等待。
 */
const MAX_BATCH = 500;
const MAX_TYPING_WAIT_MS = 1000;

let queue: BridgeEvent[] = [];
let scheduled = false;
let lastRunAt = 0;

export function enqueueGatedIngest(
  events: BridgeEvent[],
  ingest: (events: BridgeEvent[]) => void | Promise<void>
): void {
  if (!events.length) return;
  if (!queue.length && !scheduled) lastRunAt = Date.now();
  queue.push(...events);
  if (scheduled) return;
  scheduled = true;
  scheduleRun(ingest);
}

function scheduleRun(ingest: (events: BridgeEvent[]) => void | Promise<void>): void {
  if (typeof window === "undefined") return;
  if (isComposerTypingBusy() && !hasRealtimeIngestEvents(queue) &&
      Date.now() - lastRunAt < MAX_TYPING_WAIT_MS) {
    // 保持 scheduled，仅顺延重试，避免期间重复排程
    window.setTimeout(() => scheduleRun(ingest), 120);
    return;
  }
  const run = () => {
    if (!queue.length) { scheduled = false; return; }
    const batch = queue.slice(0, MAX_BATCH);
    if (batch.length < queue.length) {
      queue = queue.slice(MAX_BATCH);
    } else {
      queue = [];
    }
    const complete = () => {
      lastRunAt = Date.now();
      scheduled = false;
      if (queue.length) { scheduled = true; scheduleRun(ingest); }
    };
    const retry = (error: unknown) => {
      queue.unshift(...batch);
      console.error("[sync] ingest failed, retrying", error);
      window.setTimeout(() => scheduleRun(ingest), 1000);
    };
    try {
      const result = ingest(batch);
      if (result && typeof result.then === "function") result.then(complete, retry);
      else complete();
    } catch (error) { retry(error); }
  };
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(run, { timeout: hasRealtimeIngestEvents(queue) ? 50 : 400 });
  } else {
    window.setTimeout(run, 50);
  }
}
