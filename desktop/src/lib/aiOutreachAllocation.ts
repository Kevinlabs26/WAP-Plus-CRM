import type { OutreachState } from "./aiOutreachContext.ts";
import { indexedContactRecipient, lastContactedAccounts, recipientKey } from "./scheduledPlans.ts";
import { isConversationOutgoing } from "./leadInbox.ts";
import type { AiOutreachRule } from "./aiOutreachRules.ts";

type HistoryInput = Pick<OutreachState, "chats" | "contacts" | "messages">;
let lastHistory: { input: HistoryInput; result: ReturnType<typeof buildFirstContactHistory> } | undefined;
let lastChatIndex: {chats: HistoryInput["chats"]; contacts: HistoryInput["contacts"]; index: ReturnType<typeof indexFirstContactChats>} | undefined;

export function firstContactHistory(state: HistoryInput) {
  const {chats,contacts,messages} = state;
  if (lastHistory?.input.chats === chats && lastHistory.input.contacts === contacts && lastHistory.input.messages === messages) {
    return lastHistory.result;
  }
  const result = buildFirstContactHistory(state);
  lastHistory = {input:{chats,contacts,messages},result};
  return result;
}

function indexFirstContactChats(state: Pick<HistoryInput, "chats" | "contacts">) {
  const contacts = new Map(state.contacts.map(contact => [contact.id, contact]));
  const keys = new Map<string, string>();
  const accounts = new Map<string, string>();
  const known = new Map<string, { accountId?: string; at: string }>();
  const unknown = new Set<string>();
  const chatsByRecipient = new Map<string, OutreachState["chats"]>();
  for (const chat of state.chats) {
    const contact = contacts.get(chat.contactId);
    if (!contact || chat.localOnly || chat.isGroup || contact.isGroup) continue;
    const target = indexedContactRecipient(contact);
    if (!target || /@g\.us$/i.test(target)) continue;
    const key = recipientKey("", target);
    keys.set(chat.id, key);
    const matches = chatsByRecipient.get(key);
    if (matches) matches.push(chat);
    else chatsByRecipient.set(key,[chat]);
    const accountId = chat.accountId || contact.accountId || chat.phoneId;
    if (accountId) accounts.set(chat.id, accountId);
    if (chat.hasMessageHistory || chat.hasOutgoingHistory || chat.firstConversationMessage || chat.lastMessageDirection === "in" ||
        (chat.hasMessageHistory !== false && contact.lastMessageAt)) {
      rememberContact(known, key, chat.updatedAt, accountId);
    } else if (chat.hasMessageHistory !== false && !chat.id.startsWith("chat-c-")) {
      unknown.add(key);
    }
  }
  for (const contact of state.contacts) {
    if (contact.isGroup || !contact.lastMessageAt || !contact.phone) continue;
    const key = recipientKey("", contact.phone);
    if (!known.has(key)) unknown.add(key);
  }
  return { keys, accounts, known, unknown, chatsByRecipient, contacts };
}

function rememberContact(known: Map<string, { accountId?: string; at: string }>, key: string, at: string, accountId?: string) {
  const previous = known.get(key);
  if (!previous || at > previous.at) known.set(key, { accountId, at });
}

function buildFirstContactHistory(state: HistoryInput) {
  if (lastChatIndex?.chats !== state.chats || lastChatIndex.contacts !== state.contacts) {
    lastChatIndex = { chats: state.chats, contacts: state.contacts, index: indexFirstContactChats(state) };
  }
  const { keys, accounts, unknown, chatsByRecipient, contacts } = lastChatIndex.index;
  const known = new Map(lastChatIndex.index.known);
  for (const message of state.messages) {
    const key = keys.get(message.chatId);
    if (key && message.mediaType !== "system" && (message.direction === "in" ||
        !message.deliveryUncertain && message.deliveryStatus !== "local" && isConversationOutgoing(message))) {
      rememberContact(known, key, message.sentAt, message.accountId || accounts.get(message.chatId));
    }
  }
  const lastAccounts = lastContactedAccounts(state.chats, state.contacts, state.messages);
  for (const [key, accountId] of lastAccounts) {
    known.set(key, {accountId,at:known.get(key)?.at || ""});
  }
  return { keys, known, unknown, chatsByRecipient, contacts, lastAccounts };
}

export function allocateFirstContacts(state: OutreachState, chatIds: Iterable<string>, quotas: Record<string, number>, previous: Record<string, string> = {}, retainUsedSlots = false) {
  const { keys, known, unknown } = firstContactHistory(state);
  const recipients = [...new Set([...chatIds].flatMap(id => keys.get(id) || []))];
  const eligible = recipients.filter(key => !known.has(key) && !unknown.has(key));
  const remaining = new Map(state.settings.waAccounts.map(account => [account.id, Object.hasOwn(quotas, account.id) ? quotas[account.id] : 0]));
  const assignments: Record<string, string> = {};
  const assign = (key: string, account: string) => {
    const count = remaining.get(account) || 0;
    if (!count) return;
    assignments[key] = account;
    remaining.set(account, count - 1);
  };
  for (const key of retainUsedSlots ? Object.keys(previous) : eligible) {
    if (Object.hasOwn(previous, key)) assign(key, previous[key]);
  }
  for (const key of eligible) {
    if (Object.hasOwn(assignments, key)) continue;
    const account = [...remaining].find(([, count]) => count > 0)?.[0];
    if (account) assign(key, account);
  }
  return { assignments, eligible: eligible.length, existing: recipients.filter(key => known.has(key)).length };
}

export function extendScheduledFirstContactAssignments(state: OutreachState, chatIds: Iterable<string>, rule: AiOutreachRule) {
  if (!rule.enabled || rule.startMode !== "scheduled" || !rule.firstContactQuotas) return rule;
  const history = firstContactHistory(state);
  const members = [...chatIds];
  const reserved = new Set(members.map(id => history.keys.get(id)));
  const messageById = new Map(state.messages.map(message => [message.id,message]));
  for (const run of state.settings.aiOutreachRuns || []) {
    const message = run.messageId && messageById.get(run.messageId);
    if (run.recipient && (run.status === "sent" || run.status === "queued" || run.messageId && !message)) reserved.add(recipientKey("",run.recipient));
  }
  for (const message of state.messages) {
    if (message.direction !== "out" || !(message.deliveryUncertain || message.deliveryStatus === "pending" || message.deliveryStatus === "queued")) continue;
    reserved.add(history.keys.get(message.chatId) || (message.phoneE164 ? recipientKey("",message.phoneE164) : undefined));
  }
  const previous = activeFirstContactAssignments(rule);
  const retained = Object.fromEntries(Object.entries(previous).filter(([key]) => reserved.has(key) || history.lastAccounts.has(key) || history.unknown.has(key)));
  const { assignments } = allocateFirstContacts(state, members, rule.firstContactQuotas, retained, true);
  const overlay: NonNullable<AiOutreachRule["scheduledFirstContactAssignments"]> = {};
  for (const key of Object.keys(rule.firstContactAssignments || {})) {
    if (!Object.hasOwn(assignments,key)) overlay[key] = null;
  }
  for (const [key,account] of Object.entries(assignments)) {
    if (rule.firstContactAssignments?.[key] !== account) overlay[key] = account;
  }
  const current = rule.scheduledFirstContactAssignments || {};
  const entries = Object.entries(overlay);
  return entries.length === Object.keys(current).length && entries.every(([key, account]) => current[key] === account)
    ? rule : {...rule, scheduledFirstContactAssignments:overlay};
}

export function activeFirstContactAssignments(rule: AiOutreachRule): Record<string, string> {
  return Object.fromEntries(Object.entries({...rule.firstContactAssignments, ...rule.scheduledFirstContactAssignments})
    .filter((entry): entry is [string,string] => typeof entry[1] === "string"));
}
