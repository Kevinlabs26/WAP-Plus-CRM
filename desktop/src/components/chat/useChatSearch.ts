import { useEffect, useMemo, useState } from "react";
import type { Message } from "@/types/crm";
import { messagePlainText } from "./chatPanelHelpers";

/**
 * 会话内消息搜索：关键词 → 命中列表 + 上/下条定位（聚焦气泡），
 * 从 ChatPanel 抽离。
 */
export function useChatSearch(opts: {
  chatMessages: Message[];
  setFocusMessageId: (id: string | null) => void;
}) {
  const { chatMessages, setFocusMessageId } = opts;
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState("");
  const [chatSearchIndex, setChatSearchIndex] = useState(-1);

  const chatSearchMatches = useMemo(() => {
    const query = chatSearchQuery.trim().toLocaleLowerCase();
    if (!query) return [];
    return chatMessages.filter((message) =>
      messagePlainText(message).toLocaleLowerCase().includes(query)
    );
  }, [chatMessages, chatSearchQuery]);

  const showSearchMatch = (index: number) => {
    if (!chatSearchMatches.length) return;
    const next = (index + chatSearchMatches.length) % chatSearchMatches.length;
    setChatSearchIndex(next);
    setFocusMessageId(chatSearchMatches[next]!.id);
  };

  useEffect(() => {
    if (!chatSearchOpen || !chatSearchMatches.length) {
      setChatSearchIndex(-1);
      return;
    }
    const newest = chatSearchMatches.length - 1;
    setChatSearchIndex(newest);
    setFocusMessageId(chatSearchMatches[newest]!.id);
  }, [chatSearchMatches, chatSearchOpen, setFocusMessageId]);

  /** 切换会话时重置 */
  const resetSearch = () => {
    setChatSearchOpen(false);
    setChatSearchQuery("");
  };

  return {
    chatSearchOpen,
    setChatSearchOpen,
    chatSearchQuery,
    setChatSearchQuery,
    chatSearchIndex,
    setChatSearchIndex,
    chatSearchMatches,
    showSearchMatch,
    resetSearch,
  };
}
