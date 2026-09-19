import type { BridgeEvent } from "./bridge";
import { isComposerTypingBusy } from "./composerActivity.ts";

/**
 * 直接事件推送（Android Bridge `bridge://event`）也走「打字让路」队列：
 * 输入框聚焦且近期有输入时只入队不执行，等空闲片再合并入库，
 * 避免同步 ingest 的整批克隆/重排抢占主线程卡住打字。
 */
const MAX_BATCH = 500;

let queue: BridgeEvent[] = [];
let scheduled = false;

export function enqueueGatedIngest(
  events: BridgeEvent[],
  ingest: (events: BridgeEvent[]) => void
): void {
  if (!events.length) return;
  queue.push(...events);
  if (scheduled) return;
  scheduled = true;
  scheduleRun(ingest);
}

function scheduleRun(ingest: (events: BridgeEvent[]) => void): void {
  if (typeof window === "undefined") return;
  if (isComposerTypingBusy()) {
    // 保持 scheduled，仅顺延重试，避免期间重复排程
    window.setTimeout(() => scheduleRun(ingest), 120);
    return;
  }
  const run = () => {
    scheduled = false;
    if (!queue.length) return;
    const batch = queue.slice(0, MAX_BATCH);
    if (batch.length < queue.length) {
      queue = queue.slice(MAX_BATCH);
    } else {
      queue = [];
    }
    ingest(batch);
    if (queue.length) scheduleRun(ingest);
  };
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(run, { timeout: 400 });
  } else {
    window.setTimeout(run, 50);
  }
}
