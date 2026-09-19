import type { ChatPreview, Contact, Message } from "@/types/crm";
import { buildPersonKey } from "@/lib/utils";
import { ingestObject, ingestString } from "./bridgeIngestHelpers";
import {
  createChatIdLookup,
  createContactLookup,
  type ContactLookup,
} from "./contactIndex";
import {
  applyNameToChats,
  isInternalContactName,
} from "./contactIngestHelpers";
import { parseContactItem } from "./parseContactItem";
import { DEFAULT_ACCOUNT_ID } from "@/types/account";
import { isSyncDebugEnabled, syncLog } from "@/lib/syncDebug";
import { reconcileChatsForContacts } from "./chatReconcile";
import { restoreLocalContactChats } from "./localContactChats";

export type ContactIngestBag = {
  contacts: Contact[];
  chats: ChatPreview[];
  messages: Message[];
  nextSelectedChatId: string | null;
  nextSelectedContactId: string | null;
  /** 批内联系人查找索引（惰性构建），避免逐条全表扫描 */
  _contactLookup?: ContactLookup;
};

/**
 * 确保 bridge 推送的联系人落库（含 LID/手机号合并、幽灵自己过滤）。
 * 可能改写 bag 内 contacts/chats/messages/selection。
 */
export function ensureIngestContact(
  bag: ContactIngestBag,
  item: Record<string, unknown>,
  deviceId: string,
  selfName: string
): Contact | null {
  let { contacts, chats, messages } = bag;
  let { nextSelectedChatId, nextSelectedContactId } = bag;
  const string = ingestString;

  const parsed = parseContactItem(item, selfName);
  if (!parsed) return null;
  const {
    jid,
    pnJid,
    channelAddress,
    isGroup,
    participantCount,
    phone,
    name,
    niceName,
    avatarUrl,
    avatarFullUrl,
  } = parsed;

  const contactOwner = (contact: Contact) =>
    contact.accountId || contact.boundPhoneId || DEFAULT_ACCOUNT_ID;

  // 批内 O(1) 命中；命中失败回退线性扫描，语义与原有 matchContact 完全一致
  const lookup = (bag._contactLookup ??= createContactLookup(contacts));
  let index = lookup.matchIndex({
    deviceId,
    channelAddress,
    phone,
    jid,
    pnJid,
  });
  const idKey =
    channelAddress ||
    phone ||
    jid ||
    pnJid ||
    (name ? name.toLowerCase() : "") ||
    `tmp-${string(item.id, 80) || Date.now()}`;
  const id = `bridge-contact-${encodeURIComponent(`${deviceId}:${idKey}`)}`;
  if (index < 0) {
    index = lookup.idIndex(id);
  }

  if (index >= 0 && phone) {
    const dupIdx = contacts.findIndex(
      (c, i) =>
        i !== index &&
        contactOwner(c) === deviceId &&
        ((channelAddress && c.channelAddress === channelAddress) ||
          (c.phone && c.phone === phone) ||
          (jid && c.channelAddress === jid))
    );
    if (dupIdx >= 0) {
      const keep = contacts[index];
      const drop = contacts[dupIdx];
      const keepId = keep.id;
      const dropId = drop.id;
      contacts[index] = {
        ...keep,
        name: !isInternalContactName(keep.name)
          ? keep.name
          : !isInternalContactName(drop.name)
            ? drop.name
            : keep.name || drop.name,
        phone: keep.phone || drop.phone || phone,
        channelAddress:
          (keep.channelAddress?.includes("@lid")
            ? keep.channelAddress
            : drop.channelAddress?.includes("@lid")
              ? drop.channelAddress
              : keep.channelAddress || drop.channelAddress) ||
          channelAddress ||
          undefined,
        avatarUrl: keep.avatarUrl || drop.avatarUrl,
        tags: Array.from(new Set([...(keep.tags || []), ...(drop.tags || [])])),
        notes: keep.notes || drop.notes,
        aiSummary: keep.aiSummary || drop.aiSummary,
        aiIntent: keep.aiIntent || drop.aiIntent,
        aiNextStep: keep.aiNextStep || drop.aiNextStep,
        aiSuggestedStage: keep.aiSuggestedStage || drop.aiSuggestedStage,
        aiInsightAt: keep.aiInsightAt || drop.aiInsightAt,
        stage: keep.stage !== "new" ? keep.stage : drop.stage,
        company: keep.company || drop.company,
        country: keep.country || drop.country,
      };
      const dropChatId = `bridge-chat-${dropId}`;
      const keepChatId = `bridge-chat-${keepId}`;
      messages = messages.map((m) =>
        m.chatId === dropChatId
          ? { ...m, chatId: keepChatId, contactId: keepId }
          : m.contactId === dropId
            ? { ...m, contactId: keepId }
            : m
      );
      const dropChat = chats.find((c) => c.id === dropChatId);
      const keepChatIdx = chats.findIndex((c) => c.id === keepChatId);
      if (dropChat) {
        if (keepChatIdx >= 0) {
          const kc = chats[keepChatIdx];
          chats[keepChatIdx] = {
            ...kc,
            lastMessage:
              (dropChat.updatedAt || "") >= (kc.updatedAt || "")
                ? dropChat.lastMessage || kc.lastMessage
                : kc.lastMessage || dropChat.lastMessage,
            updatedAt:
              (dropChat.updatedAt || "") >= (kc.updatedAt || "")
                ? dropChat.updatedAt
                : kc.updatedAt,
            unread: (kc.unread || 0) + (dropChat.unread || 0),
            contactName: !isInternalContactName(kc.contactName)
              ? kc.contactName
              : dropChat.contactName || kc.contactName,
          };
          chats = chats.filter((c) => c.id !== dropChatId);
        } else {
          chats = chats.map((c) =>
            c.id === dropChatId
              ? { ...c, id: keepChatId, contactId: keepId }
              : c
          );
        }
      }
      chats = chats.map((c) =>
        c.contactId === dropId ? { ...c, contactId: keepId } : c
      );
      if (nextSelectedContactId === dropId) nextSelectedContactId = keepId;
      if (nextSelectedChatId === dropChatId) nextSelectedChatId = keepChatId;
      contacts.splice(dupIdx, 1);
      if (dupIdx < index) index -= 1;
    }
  }

  if (index >= 0) {
    const prev = contacts[index];
    const prevNameInternal = isInternalContactName(prev.name, {
      isGroup: isGroup || prev.isGroup,
    });
    const nextPhone = phone || prev.phone;
    // 群：有真 subject 就更新；空/占位不覆盖已有群名
    const nextName =
      name && !isInternalContactName(name, { isGroup: isGroup || prev.isGroup })
        ? name
        : prevNameInternal
          ? (isGroup || prev.isGroup
              ? niceName || prev.name
              : nextPhone || niceName || prev.name)
          : prev.name;
    const nextChannel =
      (channelAddress && channelAddress.includes("@lid")
        ? channelAddress
        : prev.channelAddress && prev.channelAddress.includes("@lid")
          ? prev.channelAddress
          : channelAddress || prev.channelAddress || jid) || undefined;
    const nextContact = {
      ...prev,
      name: nextName,
      phone: nextPhone,
      channelAddress: nextChannel,
      boundPhoneId: deviceId,
      accountId: deviceId,
      personKey:
        prev.personKey ||
        buildPersonKey({
          phone: nextPhone,
          channelAddress: nextChannel,
          jid,
          isGroup: isGroup || prev.isGroup,
        }),
      // 群聊头像为空时要清掉旧缓存，避免个人头像残留到群行。
      avatarUrl: isGroup ? avatarUrl || undefined : avatarUrl || prev.avatarUrl,
      avatarFullUrl: isGroup
        ? avatarFullUrl || undefined
        : avatarFullUrl || prev.avatarFullUrl,
      lastMessageAt: prev.lastMessageAt,
      isGroup: isGroup || prev.isGroup,
      participantCount: Number.isFinite(participantCount)
        ? participantCount
        : prev.participantCount,
      groupOwner:
        (typeof item.groupOwner === "string" && item.groupOwner) ||
        prev.groupOwner,
      groupDesc:
        (typeof item.groupDesc === "string" && item.groupDesc) || prev.groupDesc,
      groupAnnounce:
        typeof item.groupAnnounce === "boolean"
          ? item.groupAnnounce
          : prev.groupAnnounce,
      groupRestrict:
        typeof item.groupRestrict === "boolean"
          ? item.groupRestrict
          : prev.groupRestrict,
      groupEphemeral:
        Number.isFinite(Number(item.groupEphemeral))
          ? Number(item.groupEphemeral)
          : prev.groupEphemeral,
      groupJoinApproval:
        typeof item.groupJoinApproval === "boolean"
          ? item.groupJoinApproval
          : prev.groupJoinApproval,
      groupLinkedParent:
        (typeof item.groupLinkedParent === "string" && item.groupLinkedParent) ||
        prev.groupLinkedParent,
      groupIsCommunity:
        typeof item.groupIsCommunity === "boolean"
          ? item.groupIsCommunity
          : prev.groupIsCommunity,
    };
    const contactChanged = (Object.keys(nextContact) as (keyof Contact)[]).some(
      (key) => nextContact[key] !== prev[key]
    );
    if (contactChanged) {
      contacts[index] = nextContact;
      if (nextContact.name !== prev.name) {
        chats = applyNameToChats(chats, nextContact.id, nextContact.name, {
          isGroup: nextContact.isGroup,
        });
      }
    }
    bag.contacts = contacts;
    bag.chats = chats;
    bag.messages = messages;
    bag.nextSelectedChatId = nextSelectedChatId;
    bag.nextSelectedContactId = nextSelectedContactId;
    return contacts[index];
  }

  const contact: Contact = {
    id,
    name: niceName,
    phone: phone || "",
    channelAddress: channelAddress || jid || undefined,
    tags: [],
    stage: "new",
    boundPhoneId: deviceId,
    accountId: deviceId,
    personKey: buildPersonKey({
      phone,
      channelAddress: channelAddress || jid,
      jid,
      isGroup,
    }),
    avatarUrl: avatarUrl || undefined,
    avatarFullUrl: avatarFullUrl || undefined,
    isGroup,
    participantCount: Number.isFinite(participantCount)
      ? participantCount
      : undefined,
  };
  contacts.push(contact);
  chats = applyNameToChats(chats, contact.id, contact.name, {
    isGroup: contact.isGroup,
  });
  bag.contacts = contacts;
  bag.chats = chats;
  bag.messages = messages;
  bag.nextSelectedChatId = nextSelectedChatId;
  bag.nextSelectedContactId = nextSelectedContactId;
  return contact;
}

/** contacts.sync：写通讯录；并确保有会话行（多号第二账号常只有通讯录、lastMessage 为空） */
export function applyContactsSync(
  bag: ContactIngestBag,
  items: unknown[],
  deviceId: string,
  selfName: string,
  eventTs?: number,
  finalize = true
): void {
  const debugEnabled = isSyncDebugEnabled();
  let createdContacts = 0;
  let updatedContacts = 0;
  let createdChats = 0;
  let skippedNoChat = 0;
  let skippedNull = 0;
  const beforeContactN = debugEnabled ? bag.contacts.length : 0;
  const beforeChatN = debugEnabled ? bag.chats.length : 0;
  const knownContactIds = debugEnabled
    ? new Set(bag.contacts.map((contact) => contact.id))
    : null;
  // 批内会话查找索引：替代逐条 chats.findIndex 全表扫描
  const chatLookup = createChatIdLookup();
  const chatIdxOf = (id: string) => chatLookup.idx(bag.chats, id);

  for (const raw of items) {
    const item = ingestObject(raw);
    if (!item) continue;
    const contact = ensureIngestContact(bag, item, deviceId, selfName);
    if (!contact) {
      skippedNull++;
      continue;
    }
    if (knownContactIds?.has(contact.id)) updatedContacts++;
    else if (knownContactIds) {
      createdContacts++;
      knownContactIds.add(contact.id);
    }
    const { contacts, chats } = bag;
    const id = `bridge-chat-${contact.id}`;
    const index = chatIdxOf(id);
    const lastFromSync = ingestString(item.lastMessage, 500);
    const ts =
      Number(item.conversationTimestamp) ||
      Number(item.updatedAt) ||
      eventTs ||
      Date.now();
    const updatedAt = new Date(
      ts < 1e12 ? ts * 1000 : ts
    ).toISOString();
    // 仅「真聊过」才进会话列表：有效预览正文，或 WhatsApp 会话时间戳
    // （不要因通讯录有手机号就建会话 → 否则会话=全量联系人）
    const meaningfulPreview = !!(
      lastFromSync &&
      lastFromSync.trim() &&
      lastFromSync.trim() !== " "
    );
    const hasChatActivity =
      meaningfulPreview ||
      Number(item.conversationTimestamp) > 0 ||
      Number(item.conversationTimestampMs) > 0 ||
      Number(item.lastMsgTimestamp) > 0;
    const shouldHaveChat = hasChatActivity;
    if (index < 0) {
      if (!shouldHaveChat) {
        skippedNoChat++;
        continue;
      }
      chats.push({
        id,
        contactId: contact.id,
        contactName: contact.name,
        lastMessage: meaningfulPreview ? lastFromSync.trim() : "",
        unread: 0,
        updatedAt,
        phoneId: deviceId,
        accountId: deviceId,
        isGroup: contact.isGroup,
      });
      bag.chats = chats;
      createdChats++;
      continue;
    }
    const prev = chats[index];
    const betterName =
      contact.name && !isInternalContactName(contact.name)
        ? contact.name
        : prev.contactName && !isInternalContactName(prev.contactName)
          ? prev.contactName
          : contact.name || prev.contactName;
    // 通讯录同步不覆盖已有预览；无活动也不把空壳会话「续命」
    // 排序用时间：仅当同步带来「更新」的真实预览时才抬升；
    // 群元数据/通讯录刷新不得把群顶到最近列表最前。
    const prevAt = prev.updatedAt || "";
    let nextUpdatedAt = prevAt;
    if (meaningfulPreview) {
      // 有新预览：时间取较大者（避免旧 history 把时间打回去也不要无脑用 sync ts 盖过私聊）
      nextUpdatedAt =
        !prevAt || updatedAt >= prevAt ? updatedAt : prevAt;
    } else if (!prevAt && hasChatActivity) {
      nextUpdatedAt = updatedAt;
    }
    const nextChat = {
      ...prev,
      contactName: betterName,
      lastMessage: meaningfulPreview
        ? lastFromSync.trim()
        : prev.lastMessage,
      phoneId: prev.phoneId || deviceId,
      accountId: prev.accountId || deviceId,
      isGroup: contact.isGroup || prev.isGroup,
      updatedAt: nextUpdatedAt,
    };
    if (
      nextChat.contactName !== prev.contactName ||
      nextChat.lastMessage !== prev.lastMessage ||
      nextChat.phoneId !== prev.phoneId ||
      nextChat.accountId !== prev.accountId ||
      nextChat.isGroup !== prev.isGroup ||
      nextChat.updatedAt !== prev.updatedAt
    ) {
      chats[index] = nextChat;
    }
    bag.chats = chats;
    bag.contacts = contacts;
  }

  // 统一走共享协调规则：有效联系人对应的空会话必须保留。
  // Large snapshots are split into small UI-friendly chunks. Reconcile the
  // whole database only after the final chunk, not after every 16 contacts.
  if (finalize) {
    bag.chats = reconcileChatsForContacts(
      restoreLocalContactChats(bag.chats, bag.contacts),
      bag.messages,
      bag.contacts
    );
  }

  // Do not scan the complete contact list just to build a disabled log entry.
  if (debugEnabled) {
    syncLog("ingest.contacts", "applyContactsSync", {
      deviceId,
      itemsIn: items.length,
      final: finalize,
      createdContacts,
      updatedContacts,
      createdChats,
      skippedNull,
      skippedNoChat,
      bagContacts: bag.contacts.length,
      bagChats: bag.chats.length,
      deltaContacts: bag.contacts.length - beforeContactN,
      deltaChats: bag.chats.length - beforeChatN,
      ownedByDevice: bag.contacts.filter(
        (c) => (c.accountId || c.boundPhoneId) === deviceId
      ).length,
    });
  }
}
