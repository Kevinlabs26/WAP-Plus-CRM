import type { Message } from "@/types/crm";

export type ChatLink = {
  url: string;
  host: string;
  sentAt: string;
  messageId: string;
};

const URL_PATTERN = /https?:\/\/[^\s<>"'，。；！？、（）【】]+/gi;

export function extractChatLinks(messages: Message[]): ChatLink[] {
  const links = new Map<string, ChatLink>();
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message) continue;
    const text = [message.body, message.mediaCaption].filter(Boolean).join(" ");
    for (const match of text.matchAll(URL_PATTERN)) {
      const url = match[0].replace(/[),.;!?，。；！？）]+$/u, "");
      if (links.has(url)) continue;
      try {
        links.set(url, {
          url,
          host: new URL(url).hostname,
          sentAt: message.sentAt,
          messageId: message.id,
        });
      } catch {
        /* ignore malformed URL */
      }
    }
  }
  return [...links.values()];
}
