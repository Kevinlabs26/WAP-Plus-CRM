import { cloneCallTarget, type CloneCallTarget } from "@/lib/cloneCalls";
import { normalizePastedPhone } from "@/lib/pastedContacts";
import { displayContactLabel, resolveSendTarget } from "@/lib/utils";
import { LEAD_INBOX_FOLDER_ID } from "@/store/settingsDefaults";
import type { useAppStore } from "@/store/appStore";
import type { Message } from "@/types/crm";
import { prioritizeFolderChats } from "@/components/layout/buildSidebarItems";

type FolderCallState = Pick<ReturnType<typeof useAppStore.getState>, "chats" | "contacts" | "settings" | "messagesByChatId">;
export type FolderCallRow = { phone: string; name: string; avatarUrl?: string; chatIds: string[] };
export type FolderCallStatus = "waiting" | "checking" | "unknown" | "single" | "unavailable" | "calling" | "paused" | "ended" | "confirmed";
export const FOLDER_CALL_DELAY = 5000;

export function folderCallRows(state: FolderCallState, folderId: string): FolderCallRow[] {
  const { settings } = state;
  const folder = settings.chatFolders.find(item => item.id === folderId);
  if (!folder) return [];
  const contacts = new Map(state.contacts.map(contact => [contact.id, contact]));
  const chats = new Map(state.chats.map(chat => [chat.id, chat]));
  const byIds = (ids: string[]) => ids.flatMap(id => {
    const chat = chats.get(id);
    return chat ? [chat] : [];
  });
  const dismissed = new Set(folderId === LEAD_INBOX_FOLDER_ID ? settings.leadInbox.dismissedChatIds : []);
  const leadIds = folderId === LEAD_INBOX_FOLDER_ID
    ? settings.leadInbox.collectedChatIds.filter(id => !dismissed.has(id))
    : [];
  const ordered = [
    ...byIds(leadIds),
    ...prioritizeFolderChats(byIds(folder.chatIds)),
    ...byIds(settings.chatFolderClones.filter(clone => clone.folderId === folderId).map(clone => clone.sourceChatId)),
  ];
  const rows = new Map<string, FolderCallRow>();
  for (const chat of ordered) {
    const contact = contacts.get(chat.contactId);
    if (chat.isGroup || chat.localOnly || contact?.isGroup || contact?.channelAddress?.endsWith("@g.us")) continue;
    const owner = chat.accountId || contact?.accountId || chat.lastSuccessfulOutgoing?.accountId;
    if (folder.scope?.type === "account" && owner !== folder.scope.accountId) continue;
    const phone = normalizePastedPhone(resolveSendTarget({
      phone: contact?.phone, channelAddress: contact?.channelAddress, entityId: chat.contactId,
    }));
    if (!phone) continue;
    const row: FolderCallRow = rows.get(phone) || { phone, name: phone, chatIds: [] };
    if (row.name === phone) {
      const contactName = displayContactLabel(contact?.name, phone);
      row.name = contactName === phone ? displayContactLabel(chat.contactName, phone) : contactName;
    }
    row.avatarUrl ||= contact?.avatarUrl || contact?.avatarFullUrl;
    if (!row.chatIds.includes(chat.id)) row.chatIds.push(chat.id);
    rows.set(phone, row);
  }
  return [...rows.values()];
}

export function filterFolderCallRows(rows: FolderCallRow[], input: string) {
  const entries = input.split(/[\r\n,;，；]+/u).map(value => value.trim()).filter(Boolean);
  const normalized = entries.map(value => normalizePastedPhone(value));
  const phones = new Set(normalized.filter(Boolean));
  const selected = rows.filter(row => phones.has(row.phone));
  return {
    selected,
    invalid: normalized.filter(value => !value).length,
    unmatched: phones.size - selected.length,
  };
}

export function folderCallDecision(row: FolderCallRow, state: FolderCallState, stored: (Message | null)[]):
  "unknown" | "single" | "unavailable" | CloneCallTarget {
  const messages = new Map(stored.flatMap(message => message ? [[message.id, message] as const] : []));
  for (const id of row.chatIds) {
    for (const message of state.messagesByChatId[id] || []) messages.set(message.id, message);
  }
  let latest: Message | undefined;
  let latestTime = -Infinity;
  for (const message of messages.values()) {
    if (message.direction !== "out" || message.mediaType === "system") continue;
    const time = Date.parse(message.sentAt);
    if (!Number.isFinite(time)) return "unknown";
    if (!latest || time > latestTime || (time === latestTime && message.id > latest.id)) {
      latest = message;
      latestTime = time;
    }
  }
  if (!latest || latest.deliveryUncertain) return "unknown";
  if (latest.deliveryStatus === "sent" || latest.deliveryStatus === "server") return "single";
  if (!["delivered", "read", "played"].includes(latest.deliveryStatus || "")) return "unknown";
  const chat = state.chats.find(item => item.id === latest.chatId);
  if (!chat || chat.historyRemapBlocked) return "unavailable";
  const contact = state.contacts.find(item => item.id === chat.contactId);
  const target = cloneCallTarget(chat, contact, state.settings.waAccounts, latest.accountId || latest.deviceId || undefined);
  if (!target || target.recipientPhone !== row.phone ||
      (latest.accountPhoneE164 && latest.accountPhoneE164 !== target.ownerPhone)) return "unavailable";
  return target;
}

export function folderCallDirectTarget(row: FolderCallRow, state: FolderCallState): CloneCallTarget | "unavailable" {
  for (const id of row.chatIds) {
    const chat = state.chats.find(item => item.id === id);
    if (!chat || chat.historyRemapBlocked) continue;
    const contact = state.contacts.find(item => item.id === chat.contactId);
    const target = cloneCallTarget(chat, contact, state.settings.waAccounts);
    if (target?.recipientPhone === row.phone) return target;
  }
  return "unavailable";
}

export async function runFolderCallQueue(rows: FolderCallRow[], deps: {
  signal: AbortSignal;
  check: (row: FolderCallRow) => Promise<ReturnType<typeof folderCallDecision>>;
  dial: (target: CloneCallTarget) => Promise<boolean>;
  status: (index: number, status: FolderCallStatus, error?: string) => void;
  waitForUser: () => Promise<void>;
  wait: (ms: number) => Promise<void>;
}) {
  for (const [index, row] of rows.entries()) {
    if (deps.signal.aborted) return;
    deps.status(index, "checking");
    const decision = await deps.check(row).catch(() => "unknown" as const);
    if (deps.signal.aborted) return;
    if (typeof decision === "string") {
      deps.status(index, decision);
      continue;
    }
    deps.status(index, "calling");
    let ended = false;
    let error: string | undefined;
    try {
      ended = await deps.dial(decision);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    if (deps.signal.aborted) return;
    if (!ended) {
      deps.status(index, "paused", error);
      await deps.waitForUser();
      if (deps.signal.aborted) return;
    }
    deps.status(index, ended ? "ended" : "confirmed");
    if (index < rows.length - 1) await deps.wait(FOLDER_CALL_DELAY);
  }
}
