import { useCallback, useMemo, useState } from "react";
import type { Message } from "@/types/crm";
import { inferMediaType } from "./messageMediaUtils";

export type SavedFilter =
  | "all"
  | "text"
  | "image"
  | "video"
  | "audio"
  | "file"
  | "tag";

const EMPTY_TAGS: string[] = [];

/**
 * 收藏夹（我的收藏 / SAVED_MESSAGES_CHAT_ID）列表状态：
 * 草稿、筛选、标签、批量选择 + 展示用 memo，从 ChatPanel 抽离。
 */
export function useSavedMessages(opts: {
  chatMessages: Message[];
  localOnlyChat: boolean;
}) {
  const { chatMessages, localOnlyChat } = opts;
  const [savedDraft, setSavedDraft] = useState("");
  const [savedFilter, setSavedFilter] = useState<SavedFilter>("all");
  const [savedTagFilter, setSavedTagFilter] = useState("all");
  const [savedSelectMode, setSavedSelectMode] = useState(false);
  const [savedSelectedIds, setSavedSelectedIds] = useState<Set<string>>(
    () => new Set()
  );

  const savedVisibleMessages = useMemo(() => {
    if (!localOnlyChat) return chatMessages;
    const filtered = chatMessages.filter((message) => {
      if (savedFilter === "all") return true;
      if (savedFilter === "tag") {
        return (
          savedTagFilter === "all" ||
          Boolean(message.savedTags?.includes(savedTagFilter))
        );
      }
      const kind = inferMediaType(message);
      if (savedFilter === "text") return !kind;
      if (savedFilter === "image") return kind === "image" || kind === "sticker";
      if (savedFilter === "video") return kind === "video" || kind === "gif";
      if (savedFilter === "audio") return kind === "audio";
      return kind === "document";
    });
    return filtered.slice().sort(
      (a, b) =>
        Number(Boolean(b.savedPinned)) - Number(Boolean(a.savedPinned)) ||
        a.sentAt.localeCompare(b.sentAt)
    );
  }, [chatMessages, localOnlyChat, savedFilter, savedTagFilter]);

  const savedTags = useMemo(
    () =>
      localOnlyChat
        ? [
            ...new Set(
              chatMessages.flatMap((message) => message.savedTags || [])
            ),
          ].sort((a, b) => a.localeCompare(b, "zh"))
        : EMPTY_TAGS,
    [chatMessages, localOnlyChat]
  );

  const savedVisibleIds = useMemo(
    () => new Set(savedVisibleMessages.map((message) => message.id)),
    [savedVisibleMessages]
  );

  const toggleSavedSelection = useCallback((id: string) => {
    setSavedSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSavedSelection = useCallback(() => {
    setSavedSelectedIds(new Set());
    setSavedSelectMode(false);
  }, []);

  /** 切换会话时重置 */
  const resetSaved = useCallback(() => {
    setSavedSelectMode(false);
    setSavedSelectedIds(new Set());
  }, []);

  return {
    savedDraft,
    setSavedDraft,
    savedFilter,
    setSavedFilter,
    savedTagFilter,
    setSavedTagFilter,
    savedSelectMode,
    setSavedSelectMode,
    savedSelectedIds,
    setSavedSelectedIds,
    savedVisibleMessages,
    savedTags,
    savedVisibleIds,
    toggleSavedSelection,
    clearSavedSelection,
    resetSaved,
  };
}
