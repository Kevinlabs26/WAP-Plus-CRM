import type { WhatsAppLabel } from "@/types/crm";
import { request } from "./baileysCore";

export type BaileysLabelsResponse = {
  ok: boolean;
  labels: WhatsAppLabel[];
  chatLabelIds: Record<string, string[]>;
};

export const baileysLabels = (accountId?: string | null) =>
  request<BaileysLabelsResponse>("/labels", undefined, accountId);

export const baileysCreateLabel = (
  name: string,
  color = 0,
  accountId?: string | null
) =>
  request<{ ok: boolean; label: WhatsAppLabel }>("/labels", {
    method: "POST",
    body: JSON.stringify({ name, color }),
  }, accountId);

export const baileysSetChatLabel = (
  jid: string,
  labelId: string,
  enabled: boolean,
  accountId?: string | null
) =>
  request<{ ok: boolean }>("/labels/chat", {
    method: "POST",
    body: JSON.stringify({ jid, labelId, enabled }),
  }, accountId);

export const baileysSyncQuickReplies = (
  items: { id: string; title: string; body: string }[],
  accountId?: string | null
) =>
  request<{ ok: boolean; synced: number }>("/quick-replies", {
    method: "POST",
    body: JSON.stringify({ items }),
  }, accountId);

export const baileysRemoveQuickReply = (
  id: string,
  accountId?: string | null
) =>
  request<{ ok: boolean }>("/quick-replies/remove", {
    method: "POST",
    body: JSON.stringify({ id }),
  }, accountId);
