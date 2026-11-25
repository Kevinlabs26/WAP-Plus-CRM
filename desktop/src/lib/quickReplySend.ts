import type { SettingsQuickReply } from "@/store/settingsDefaults";

type QuickReplySendRequest = {
  chatId: string;
  reply: SettingsQuickReply;
  body: string;
  respond: (sent: boolean) => void;
};

type QuickReplySendListener = (request: QuickReplySendRequest) => boolean;

const listeners = new Set<QuickReplySendListener>();

export function onQuickReplySend(listener: QuickReplySendListener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function requestQuickReplySend(chatId: string, reply: SettingsQuickReply, body: string) {
  return new Promise<boolean>(resolve => {
    let settled = false;
    const request: QuickReplySendRequest = {
      chatId,
      reply,
      body,
      respond: sent => {
        if (settled) return;
        settled = true;
        resolve(sent);
      },
    };
    const claimed = [...listeners].some(listener => listener(request));
    if (!claimed) request.respond(false);
  });
}
