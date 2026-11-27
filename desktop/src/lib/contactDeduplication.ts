import type { ChatPreview, Contact, Message } from "../types/crm.ts";
import { SAVED_MESSAGES_CONTACT_ID } from "../types/crm.ts";
import { DEFAULT_ACCOUNT_ID } from "../types/account.ts";
import { accountIdsInSameBucket, resolveEntityAccountId } from "../store/accountScope.ts";
import { chatHasMessageHistory } from "./chatActivity.ts";
import {
  extractExistingContactPhone,
  isPlaceholderContactName,
} from "./contactImportRowHelpers.ts";

export interface DuplicateContactGroup {
  groupKey: string;
  accountId: string;
  normalizedPhone: string;
  keeper: Contact;
  duplicates: Contact[];
  keeperChatCount: number;
  mergedTagsPreview: string[];
}

export interface DuplicateDetectionInput {
  contacts: Contact[];
  chats: ChatPreview[];
  messages: Message[];
  accountId?: string;
  liveAccountId?: string | null;
}

interface ContactChatMetrics {
  totalChats: number;
  activeChats: number;
  chatOwnerAccountId: string;
}

function isPersonalDedupeCandidate(contact: Contact): boolean {
  if (!contact.id || contact.id === SAVED_MESSAGES_CONTACT_ID) return false;
  if (contact.isGroup || contact.channelAddress?.endsWith("@g.us")) return false;
  return true;
}

function buildContactChatMetrics(
  chats: ChatPreview[],
  messages: Message[]
): Map<string, ContactChatMetrics> {
  const messageChatIds = new Set(messages.map((message) => message.chatId));
  const metricsByContactId = new Map<string, ContactChatMetrics>();
  for (const chat of chats) {
    if (!chat.contactId || chat.isGroup || chat.localOnly) continue;
    const current = metricsByContactId.get(chat.contactId) || {
      totalChats: 0,
      activeChats: 0,
      chatOwnerAccountId: "",
    };
    current.totalChats += 1;
    if (chatHasMessageHistory(chat) || messageChatIds.has(chat.id)) {
      current.activeChats += 1;
    }
    if (!current.chatOwnerAccountId) {
      current.chatOwnerAccountId = (chat.accountId || chat.phoneId || "").trim();
    }
    metricsByContactId.set(chat.contactId, current);
  }
  return metricsByContactId;
}

function resolveCanonicalOwnerKey(
  contact: Contact,
  metrics: ContactChatMetrics | undefined,
  liveAccountId?: string | null
): string {
  const rawOwner = (
    contact.accountId ||
    contact.boundPhoneId ||
    metrics?.chatOwnerAccountId ||
    ""
  ).trim();
  const normalizedLive = (liveAccountId || "").trim();
  const resolved = resolveEntityAccountId(rawOwner, normalizedLive || DEFAULT_ACCOUNT_ID);
  if (normalizedLive && resolved === DEFAULT_ACCOUNT_ID) {
    return normalizedLive;
  }
  return resolved;
}

function scoreKeeperCandidate(
  contact: Contact,
  metrics: ContactChatMetrics | undefined
): number {
  let score = 0;
  if ((metrics?.activeChats || 0) > 0) score += 1000;
  if ((metrics?.totalChats || 0) > 0) score += 300;
  if (contact.id.startsWith("bridge-contact-")) score += 200;
  if (contact.channelAddress?.trim()) score += 100;
  if (!isPlaceholderContactName(contact.name, contact.phone)) score += 50;
  score += Math.min((contact.tags || []).length * 10, 50);
  if (contact.notes?.trim()) score += 15;
  if (contact.company?.trim()) score += 10;
  if (contact.aiSummary?.trim()) score += 10;
  if (contact.avatarUrl?.trim()) score += 5;
  return score;
}

function rankGroupCandidates(
  candidates: Contact[],
  metricsByContactId: Map<string, ContactChatMetrics>
): Contact[] {
  return [...candidates].sort((left, right) => {
    const scoreDiff =
      scoreKeeperCandidate(right, metricsByContactId.get(right.id)) -
      scoreKeeperCandidate(left, metricsByContactId.get(left.id));
    if (scoreDiff !== 0) return scoreDiff;
    return left.id.localeCompare(right.id);
  });
}

/** Find same-account contacts that share the same normalized E.164 phone number. */
export function findDuplicateContactGroups(
  input: DuplicateDetectionInput
): DuplicateContactGroup[] {
  const metricsByContactId = buildContactChatMetrics(input.chats, input.messages);
  const scopeBucket = input.accountId
    ? accountIdsInSameBucket(input.accountId, input.liveAccountId)
    : null;
  const contactsByGroupKey = new Map<string, { accountId: string; phone: string; items: Contact[] }>();

  for (const contact of input.contacts) {
    if (!isPersonalDedupeCandidate(contact)) continue;
    const normalizedPhone = extractExistingContactPhone(contact);
    if (!normalizedPhone) continue;
    const metrics = metricsByContactId.get(contact.id);
    const ownerKey = resolveCanonicalOwnerKey(contact, metrics, input.liveAccountId);
    if (scopeBucket && !scopeBucket.has(ownerKey) && !scopeBucket.has(contact.boundPhoneId || "")) {
      continue;
    }
    const groupAccount = input.accountId || ownerKey;
    const groupKey = `${groupAccount}|${normalizedPhone}`;
    const bucket = contactsByGroupKey.get(groupKey);
    if (bucket) bucket.items.push(contact);
    else contactsByGroupKey.set(groupKey, { accountId: groupAccount, phone: normalizedPhone, items: [contact] });
  }

  const groups: DuplicateContactGroup[] = [];
  for (const [groupKey, bucket] of contactsByGroupKey) {
    if (bucket.items.length < 2) continue;
    const ranked = rankGroupCandidates(bucket.items, metricsByContactId);
    const [keeper, ...duplicates] = ranked;
    groups.push({
      groupKey,
      accountId: bucket.accountId,
      normalizedPhone: bucket.phone,
      keeper,
      duplicates,
      keeperChatCount: metricsByContactId.get(keeper.id)?.totalChats || 0,
      mergedTagsPreview: Array.from(new Set(ranked.flatMap((item) => item.tags || []).filter(Boolean))),
    });
  }

  return groups.sort((left, right) => {
    const countDiff = right.duplicates.length - left.duplicates.length;
    return countDiff !== 0 ? countDiff : left.normalizedPhone.localeCompare(right.normalizedPhone);
  });
}

function mergeDistinctNotes(contacts: Contact[]): string | undefined {
  const uniqueNotes: string[] = [];
  const seen = new Set<string>();
  for (const contact of contacts) {
    const trimmed = (contact.notes || "").trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    uniqueNotes.push(trimmed);
  }
  return uniqueNotes.length ? uniqueNotes.join("\n---\n") : undefined;
}

function pickPreferredName(keeper: Contact, duplicates: Contact[], fallbackPhone: string): string {
  if (!isPlaceholderContactName(keeper.name, keeper.phone)) {
    return keeper.name.trim();
  }
  const namedDuplicate = duplicates.find(
    (item) => !isPlaceholderContactName(item.name, item.phone)
  );
  if (namedDuplicate) return namedDuplicate.name.trim();
  return keeper.name.trim() || duplicates.find((item) => item.name.trim())?.name.trim() || fallbackPhone;
}

function pickLatestIsoTimestamp(values: Array<string | undefined>): string | undefined {
  let latestValue: string | undefined;
  let latestMs = -1;
  for (const value of values) {
    if (!value) continue;
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed) && parsed > latestMs) {
      latestMs = parsed;
      latestValue = value;
    }
  }
  return latestValue;
}

/** Merge metadata from duplicate contacts into the keeper without dropping CRM details. */
export function mergeDuplicateContactFields(
  keeper: Contact,
  duplicates: Contact[],
  normalizedPhone: string
): Contact {
  const ordered = [keeper, ...duplicates];
  const firstNonEmpty = <K extends keyof Contact>(key: K): Contact[K] => {
    for (const item of ordered) {
      const value = item[key];
      if (typeof value === "string" ? value.trim() : value !== undefined && value !== null) {
        return value;
      }
    }
    return keeper[key];
  };
  return {
    ...keeper,
    name: pickPreferredName(keeper, duplicates, normalizedPhone),
    phone: normalizedPhone || keeper.phone,
    accountId: firstNonEmpty("accountId"),
    personKey: firstNonEmpty("personKey"),
    channelAddress: firstNonEmpty("channelAddress"),
    country: firstNonEmpty("country"),
    timeZone: firstNonEmpty("timeZone"),
    language: firstNonEmpty("language"),
    preferredLang: firstNonEmpty("preferredLang"),
    company: firstNonEmpty("company"),
    source: firstNonEmpty("source"),
    owner: firstNonEmpty("owner"),
    boundPhoneId: firstNonEmpty("boundPhoneId"),
    avatarUrl: firstNonEmpty("avatarUrl"),
    avatarFullUrl: firstNonEmpty("avatarFullUrl"),
    aiChatInstructions: firstNonEmpty("aiChatInstructions"),
    aiSummary: firstNonEmpty("aiSummary"),
    aiIntent: firstNonEmpty("aiIntent"),
    aiNextStep: firstNonEmpty("aiNextStep"),
    aiSuggestedStage: firstNonEmpty("aiSuggestedStage"),
    aiInsightAt: firstNonEmpty("aiInsightAt"),
    tags: Array.from(new Set(ordered.flatMap((item) => item.tags || []).filter(Boolean))),
    notes: mergeDistinctNotes(ordered),
    lastMessageAt: pickLatestIsoTimestamp(ordered.map((item) => item.lastMessageAt)),
    nextFollowUpAt: firstNonEmpty("nextFollowUpAt"),
  };
}
