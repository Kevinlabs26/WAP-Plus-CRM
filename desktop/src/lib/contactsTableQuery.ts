import type { ChatPreview, Contact, FollowUp } from "../types/crm.ts";
import { SAVED_MESSAGES_CONTACT_ID } from "../types/crm.ts";
import { DEFAULT_ACCOUNT_ID } from "../types/account.ts";
import { accountIdsInSameBucket, resolveEntityAccountId } from "../store/accountScope.ts";

export type ContactInactiveFilter = "all" | "7" | "14" | "30" | "never";
export type ContactSortField = "lastMessage" | "name" | "stage" | "nextFollowUp";
export type ContactSortDirection = "asc" | "desc";

export interface ContactsTableFilterState {
  keyword: string;
  accountId: string;
  stage: string;
  tag: string;
  inactiveDays: ContactInactiveFilter;
  onlyWithFollowUp: boolean;
  sortBy: ContactSortField;
  sortDir: ContactSortDirection;
}

export interface EnrichedContactRow {
  contact: Contact;
  resolvedAccountId: string;
  lastActiveAt: string | undefined;
  lastActiveMs: number | null;
  daysSinceContact: number | null;
  nextFollowUpAt: string | undefined;
  hasPendingFollowUp: boolean;
}

export interface ContactsTableQueryInput {
  contacts: Contact[];
  chats: ChatPreview[];
  followUps: FollowUp[];
  filter: ContactsTableFilterState;
  liveAccountId?: string | null;
  stageOrder?: string[];
  nowMs?: number;
}

export interface ContactsTableQueryResult {
  totalPeopleCount: number;
  rows: EnrichedContactRow[];
  availableTags: string[];
  pendingFollowUpCount: number;
}

const MS_PER_DAY = 86_400_000;

export function createDefaultContactsFilter(accountId = ""): ContactsTableFilterState {
  return {
    keyword: "",
    accountId,
    stage: "",
    tag: "",
    inactiveDays: "all",
    onlyWithFollowUp: false,
    sortBy: "lastMessage",
    sortDir: "desc",
  };
}

function parseTimestampMs(value?: string): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function isPersonalContact(contact: Contact): boolean {
  if (!contact.id || contact.id === SAVED_MESSAGES_CONTACT_ID) return false;
  if (contact.isGroup || contact.channelAddress?.endsWith("@g.us")) return false;
  return true;
}

function buildChatLookup(chats: ChatPreview[]) {
  const latestChatTimeByContact = new Map<string, { iso: string; ms: number }>();
  const chatOwnerByContact = new Map<string, string>();
  for (const chat of chats) {
    if (!chat.contactId || chat.isGroup || chat.localOnly) continue;
    const owner = (chat.accountId || chat.phoneId || "").trim();
    if (owner && !chatOwnerByContact.has(chat.contactId)) {
      chatOwnerByContact.set(chat.contactId, owner);
    }
    const updatedMs = parseTimestampMs(chat.updatedAt);
    if (updatedMs === null) continue;
    const previous = latestChatTimeByContact.get(chat.contactId);
    if (!previous || updatedMs > previous.ms) {
      latestChatTimeByContact.set(chat.contactId, { iso: chat.updatedAt, ms: updatedMs });
    }
  }
  return { latestChatTimeByContact, chatOwnerByContact };
}

function buildPendingFollowUpLookup(followUps: FollowUp[]): Map<string, string> {
  const earliestDueByContact = new Map<string, string>();
  for (const followUp of followUps) {
    if (followUp.done || !followUp.contactId || !followUp.dueAt) continue;
    const previous = earliestDueByContact.get(followUp.contactId);
    if (!previous || followUp.dueAt < previous) {
      earliestDueByContact.set(followUp.contactId, followUp.dueAt);
    }
  }
  return earliestDueByContact;
}

function matchesKeyword(contact: Contact, normalizedKeyword: string): boolean {
  if (!normalizedKeyword) return true;
  const fields = [
    contact.name,
    contact.phone,
    contact.company,
    contact.notes,
    ...(contact.tags || []),
  ];
  return fields.some(
    (field) => typeof field === "string" && field.toLowerCase().includes(normalizedKeyword)
  );
}

function matchesInactiveFilter(
  row: EnrichedContactRow,
  inactiveDays: ContactInactiveFilter
): boolean {
  if (inactiveDays === "all") return true;
  if (inactiveDays === "never") return row.lastActiveMs === null;
  if (row.daysSinceContact === null) return true;
  return row.daysSinceContact >= Number(inactiveDays);
}

function compareRows(
  left: EnrichedContactRow,
  right: EnrichedContactRow,
  sortBy: ContactSortField,
  sortDir: ContactSortDirection,
  stageIndexMap: Map<string, number>
): number {
  const factor = sortDir === "asc" ? 1 : -1;
  if (sortBy === "name") {
    const leftName = (left.contact.name || left.contact.phone || "").toLowerCase();
    const rightName = (right.contact.name || right.contact.phone || "").toLowerCase();
    return leftName.localeCompare(rightName) * factor;
  }
  if (sortBy === "stage") {
    const leftIdx = stageIndexMap.get(left.contact.stage) ?? 999;
    const rightIdx = stageIndexMap.get(right.contact.stage) ?? 999;
    if (leftIdx !== rightIdx) return (leftIdx - rightIdx) * factor;
    return (left.contact.name || "").localeCompare(right.contact.name || "");
  }
  if (sortBy === "nextFollowUp") {
    const leftDue = left.nextFollowUpAt || "";
    const rightDue = right.nextFollowUpAt || "";
    if (!leftDue && !rightDue) return 0;
    if (!leftDue) return 1;
    if (!rightDue) return -1;
    return leftDue.localeCompare(rightDue) * factor;
  }
  const leftMs = left.lastActiveMs ?? -1;
  const rightMs = right.lastActiveMs ?? -1;
  if (leftMs !== rightMs) return (leftMs - rightMs) * factor;
  return (left.contact.name || "").localeCompare(right.contact.name || "");
}

/** Filter, enrich, and sort CRM contacts for the full-width contacts table view. */
export function queryContactsTable(
  input: ContactsTableQueryInput
): ContactsTableQueryResult {
  const nowMs = input.nowMs ?? Date.now();
  const { latestChatTimeByContact, chatOwnerByContact } = buildChatLookup(input.chats);
  const earliestDueByContact = buildPendingFollowUpLookup(input.followUps);
  const normalizedLive = (input.liveAccountId || "").trim();
  const accountBucket = input.filter.accountId
    ? accountIdsInSameBucket(input.filter.accountId, normalizedLive)
    : null;
  const normalizedKeyword = input.filter.keyword.trim().toLowerCase();

  const tagFrequency = new Map<string, number>();
  const personalRows: EnrichedContactRow[] = [];
  let pendingFollowUpCount = 0;

  for (const contact of input.contacts) {
    if (!isPersonalContact(contact)) continue;
    for (const tag of contact.tags || []) {
      const trimmed = tag.trim();
      if (trimmed) tagFrequency.set(trimmed, (tagFrequency.get(trimmed) || 0) + 1);
    }

    const rawOwner = (
      contact.accountId ||
      contact.boundPhoneId ||
      chatOwnerByContact.get(contact.id) ||
      ""
    ).trim();
    const resolvedAccountId = resolveEntityAccountId(
      rawOwner,
      normalizedLive || DEFAULT_ACCOUNT_ID
    );
    const contactMs = parseTimestampMs(contact.lastMessageAt);
    const chatTime = latestChatTimeByContact.get(contact.id);
    const useChatTime = chatTime && (contactMs === null || chatTime.ms > contactMs);
    const lastActiveMs = useChatTime ? chatTime.ms : contactMs;
    const lastActiveAt = useChatTime ? chatTime.iso : contact.lastMessageAt;
    const daysSinceContact =
      lastActiveMs === null ? null : Math.max(0, Math.floor((nowMs - lastActiveMs) / MS_PER_DAY));
    const pendingDue = earliestDueByContact.get(contact.id);
    const nextFollowUpAt = pendingDue || contact.nextFollowUpAt;
    const hasPendingFollowUp = Boolean(pendingDue);
    if (hasPendingFollowUp) pendingFollowUpCount += 1;

    personalRows.push({
      contact,
      resolvedAccountId,
      lastActiveAt,
      lastActiveMs,
      daysSinceContact,
      nextFollowUpAt,
      hasPendingFollowUp,
    });
  }

  const filtered = personalRows.filter((row) => {
    if (accountBucket && !accountBucket.has(row.resolvedAccountId) && !accountBucket.has(row.contact.boundPhoneId || "")) {
      return false;
    }
    if (input.filter.stage && row.contact.stage !== input.filter.stage) return false;
    if (input.filter.tag && !(row.contact.tags || []).includes(input.filter.tag)) return false;
    if (input.filter.onlyWithFollowUp && !row.hasPendingFollowUp) return false;
    if (!matchesInactiveFilter(row, input.filter.inactiveDays)) return false;
    return matchesKeyword(row.contact, normalizedKeyword);
  });

  const stageIndexMap = new Map(
    (input.stageOrder || []).map((stageId, index) => [stageId, index])
  );
  filtered.sort((left, right) =>
    compareRows(left, right, input.filter.sortBy, input.filter.sortDir, stageIndexMap)
  );

  const availableTags = [...tagFrequency.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([tag]) => tag);

  return {
    totalPeopleCount: personalRows.length,
    rows: filtered,
    availableTags,
    pendingFollowUpCount,
  };
}
