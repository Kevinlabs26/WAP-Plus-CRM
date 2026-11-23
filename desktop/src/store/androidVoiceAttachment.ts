import { ANDROID_VOICE_RETURN_MAX_BYTES } from "../../../shared/protocol.ts";
import type { Message } from "@/types/crm";

export function androidVoiceAttachment(message: Message, item: Record<string, unknown>, deviceId: string) {
  if (message.id !== item.targetMessageId || (message.deviceId || message.accountId) !== deviceId ||
      message.direction !== "in" || message.mediaType !== "audio" || message.mediaUrl) return;

  const url = item.mediaUrl;
  if (typeof url !== "string" || url.length > Math.ceil(ANDROID_VOICE_RETURN_MAX_BYTES / 3) * 4 + 128) return;
  const header = /^data:(audio\/[a-z0-9.+-]+);base64,/i.exec(url);
  if (!header) return;
  const payload = url.slice(header[0].length);
  if (!payload.length || payload.length % 4 !== 0) return;
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  if (payload.length * 3 / 4 - padding > ANDROID_VOICE_RETURN_MAX_BYTES ||
      /[^A-Za-z0-9+/]/.test(payload.slice(0, payload.length - padding))) return;

  return { mediaUrl: url, mediaMime: header[1], mediaPending: false, mediaError: undefined };
}
