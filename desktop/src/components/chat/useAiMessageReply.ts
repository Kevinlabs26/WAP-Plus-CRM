import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/store/appStore";
import { generateSuggestions, getSuggestionContextKey, hasRealAiKey } from "@/lib/aiSuggest";
import { createSuggestionCache, markManualSuggestionContext } from "@/lib/aiSuggestionCache";
import { ingestString } from "@/store/bridgeIngestHelpers";
import { translateCurrent as t } from "@/i18n";
import type { Contact, Message } from "@/types/crm";

type ReplyTarget = Pick<Message, "id" | "body" | "direction">;

export function useAiMessageReply(opts: {
  chatId: string | null;
  contact?: Contact;
  accountId: string;
  messages: Message[];
  getDraft: () => string;
  editingId: string | null;
  replyTo: ReplyTarget | null;
  setDraftReply: (text: string) => void;
  setReplyTo: (reply: ReplyTarget | null) => void;
}) {
  const [aiReplyingId, setAiReplyingId] = useState<string | null>(null);
  const generation = useRef(0);
  const busy = useRef(false);
  const [cache] = useState(createSuggestionCache);
  const latest = useRef(opts);
  latest.current = opts;
  useEffect(() => {
    setAiReplyingId(null);
    return () => { generation.current++; busy.current = false; };
  }, [opts.chatId, opts.contact?.id, opts.accountId]);

  const aiReply = async (message: Message): Promise<boolean> => {
    if (busy.current || !opts.contact || !opts.chatId || message.direction !== "in" ||
        !opts.messages.some((m) => m.id === message.id && m.chatId === opts.chatId)) return false;
    const state = useAppStore.getState();
    const { pushToast, settings } = state;
    if (!hasRealAiKey(settings)) {
      pushToast(t("crmPanel.noAiHint"), "info");
      return false;
    }
    if (opts.getDraft() || opts.editingId) {
      pushToast(t("messageMenu.aiDraftBusy"), "info");
      return false;
    }
    if ((message.mediaType === "audio" && !message.transcript?.trim()) ||
        (!message.transcript?.trim() && !message.mediaCaption?.trim() &&
          (!message.body?.trim() || (message.mediaType && /^\[[^\]]+\]$/.test(message.body.trim()))))) {
      pushToast(t("messageMenu.aiNeedsText"), "info");
      return false;
    }
    const request = ++generation.current;
    const selectedAccount = state.selectedThreadAccount?.accountId;
    const selectedContact = state.selectedContactId;
    const initialReplyTo = opts.replyTo;
    const contextKey = getSuggestionContextKey(opts.contact, opts.messages, settings, opts.accountId, { replyTo: message });
    markManualSuggestionContext(getSuggestionContextKey(opts.contact, opts.messages, settings, opts.accountId));
    const sameContext = () => request === generation.current &&
      latest.current.chatId === opts.chatId && latest.current.accountId === opts.accountId &&
      useAppStore.getState().selectedChatId === opts.chatId &&
      useAppStore.getState().selectedContactId === selectedContact &&
      useAppStore.getState().selectedThreadAccount?.accountId === selectedAccount;
    busy.current = true;
    setAiReplyingId(message.id);
    try {
      const result = await cache.request(contextKey,
        () => generateSuggestions(opts.contact, opts.messages, settings, { accountId: opts.accountId, replyTo: message }));
      if (!sameContext()) return false;
      const current = latest.current;
      const currentTarget = current.messages.find((item) => item.id === message.id);
      if (!currentTarget || getSuggestionContextKey(current.contact, current.messages,
          useAppStore.getState().settings, current.accountId, { replyTo: currentTarget }) !== contextKey) {
        pushToast(t("messageMenu.aiContextChanged"), "info");
        return false;
      }
      const text = result.suggestions[0]?.text?.trim();
      if (result.fallback || !text) {
        pushToast(result.error || t("messageMenu.aiFailed"), "error");
        return false;
      }
      if (latest.current.getDraft() || latest.current.editingId || latest.current.replyTo !== initialReplyTo) {
        pushToast(t("messageMenu.aiDraftBusy"), "info");
        return false;
      }
      opts.setReplyTo({ id: message.id, direction: message.direction,
        body: ingestString(message.transcript || message.mediaCaption || message.body, 160) });
      opts.setDraftReply(text);
      pushToast(t("messageMenu.aiFilled"), "success");
      return true;
    } catch (error) {
      if (sameContext()) pushToast(error instanceof Error ? error.message : t("messageMenu.aiFailed"), "error");
      return false;
    } finally {
      if (request === generation.current) {
        busy.current = false;
        setAiReplyingId(null);
      }
    }
  };
  return { aiReply, aiReplyingId };
}
