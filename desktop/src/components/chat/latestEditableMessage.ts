import type { Message } from "@/types/crm";

/** Returns the newest plain-text message sent by the current user. */
export function findLatestEditableOutgoingMessage(
  messages: Message[]
): Message | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.direction === "out" &&
      !message.mediaType &&
      !message.systemKind &&
      Boolean(message.body?.trim())
    ) {
      return message;
    }
  }
  return null;
}
