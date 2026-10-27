import type { GenerateSuggestionsResult } from "./aiSuggest";

/** 当前界面的短期缓存；只保存真实成功结果，不落盘。 */
export function createSuggestionCache() {
  type Entry = { result?: GenerateSuggestionsResult; promise: Promise<GenerateSuggestionsResult> };
  const entries = new Map<string, Entry>();
  const get = (key: string) => {
    const entry = entries.get(key);
    if (entry) { entries.delete(key); entries.set(key, entry); }
    return entry;
  };
  return {
    get,
    request(key: string, generate: () => Promise<GenerateSuggestionsResult>, force = false) {
      const existing = get(key);
      if (existing && (!force || !existing.result)) return existing.promise;
      const entry: Entry = {
        promise: generate().then((result) => {
          if (entries.get(key) === entry) {
            if (result.fallback || result.source === "mock") entries.delete(key);
            else entry.result = result;
          }
          return result;
        }, (error: unknown) => {
          if (entries.get(key) === entry) entries.delete(key);
          throw error;
        }),
      };
      entries.set(key, entry);
      while (entries.size > 24) entries.delete(entries.keys().next().value!);
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
