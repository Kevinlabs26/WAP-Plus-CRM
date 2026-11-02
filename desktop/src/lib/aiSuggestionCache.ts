import type { GenerateSuggestionsResult } from "./aiSuggest";

export const SUGGESTION_MAX_AGE_MS = 5 * 60_000;

/** 当前界面的短期缓存；只保存真实成功结果，不落盘。 */
export function createSuggestionCache() {
  type Progress = (result: GenerateSuggestionsResult) => void;
  type Entry = { createdAt: number; expiresAt: number; result?: GenerateSuggestionsResult; promise: Promise<GenerateSuggestionsResult>;
    controller: AbortController; updates: { latest?: GenerateSuggestionsResult; listeners: Set<Progress> } };
  const entries = new Map<string, Entry>();
  const cancelPending = (key: string) => {
    const entry = entries.get(key);
    if (!entry || entry.result) return;
    entries.delete(key);
    entry.updates.listeners.clear();
    entry.controller.abort();
  };
  const get = (key: string) => {
    const entry = entries.get(key);
    if (entry && (Date.now() >= entry.expiresAt || Date.now() < entry.createdAt)) { cancelPending(key); entries.delete(key); return; }
    if (entry) { entries.delete(key); entries.set(key, entry); }
    return entry;
  };
  return {
    get,
    cancelPending,
    request(key: string, generate: (publish: Progress, signal: AbortSignal) => Promise<GenerateSuggestionsResult>, force = false, onProgress?: Progress) {
      const existing = get(key);
      if (existing && (!force || !existing.result)) {
        if (onProgress && !existing.result) {
          existing.updates.listeners.add(onProgress);
          if (existing.updates.latest) onProgress(existing.updates.latest);
        }
        return existing.promise;
      }
      const updates: Entry["updates"] = { listeners: new Set(onProgress ? [onProgress] : []) };
      const createdAt = Date.now();
      const controller = new AbortController();
      const entry: Entry = {
        createdAt, expiresAt: createdAt + SUGGESTION_MAX_AGE_MS,
        updates, controller,
        promise: generate(result => {
          if (controller.signal.aborted) return;
          updates.latest = result;
          for (const listener of updates.listeners) listener(result);
        }, controller.signal).then((result) => {
          updates.listeners.clear();
          controller.signal.throwIfAborted();
          if (Date.now() >= entry.expiresAt || Date.now() < entry.createdAt) {
            if (entries.get(key) === entry) entries.delete(key);
            throw new Error("Reply suggestions expired; please generate again.");
          }
          if (entries.get(key) === entry) {
            if (result.fallback || result.source === "mock") entries.delete(key);
            else entry.result = result;
          }
          return result;
        }, (error: unknown) => {
          updates.listeners.clear();
          if (entries.get(key) === entry) entries.delete(key);
          throw error;
        }),
      };
      entries.set(key, entry);
      while (entries.size > 24) {
        const oldest = entries.keys().next().value!;
        cancelPending(oldest);
        entries.delete(oldest);
      }
      return entry.promise;
    },
  };
}

const manualContexts = new Set<string>();

export function markManualSuggestionContext(key: string) {
  manualContexts.delete(key);
  manualContexts.add(key);
  while (manualContexts.size > 24) manualContexts.delete(manualContexts.values().next().value!);
}

export function isManualSuggestionContext(key: string) {
  return manualContexts.has(key);
}
