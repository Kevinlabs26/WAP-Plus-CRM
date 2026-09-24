import type {
  ChatPreview,
  Contact,
  Message,
} from "@/types/crm";
import type { ContactIngestBag } from "./contactIngest";
import { ensureIngestContact } from "./contactIngest";
import {
  isInternalContactName,
  looksLikeSelfContact,
} from "./contactIngestHelpers";
import {
  deliveryAckRank,
  ingestObject,
  ingestString,
} from "./bridgeIngestHelpers";
import { noteTrendMessage } from "./trendBuckets";
import { parseMessageItem } from "./parseMessageItem";
import {
  accountMessageIndexKey,
  createMessageSyncIndex,
  messageMatchesAccountAlias,
  reuseMessageSyncIndex,
  setMessageIndexAlias,
  type MessageSyncIndex,
} from "./messageSyncIndex";
import { createChatIdLookup } from "./contactIndex";
import { isConversationOutgoing } from "@/lib/leadInbox";

let cachedMessageSyncIndex: MessageSyncIndex<Message> | null = null;

function sameWaveform(a?: number[], b?: number[]): boolean {
  return a === b || Boolean(
    a && b && a.length === b.length && a.every((value, index) => value === b[index])
  );
}

/** 展示级浅比较：enrich/回显时内容未变则保留原引用，避免击穿消息缓存 */
function shallowMessageSame(a: Message, b: Message): boolean {
  return (
    a.id === b.id &&
    a.body === b.body &&
    a.mediaType === b.mediaType &&
    a.mediaUrl === b.mediaUrl &&
    a.mediaMime === b.mediaMime &&
    a.mediaFileName === b.mediaFileName &&
    a.mediaSeconds === b.mediaSeconds &&
    a.mediaPtt === b.mediaPtt &&
    sameWaveform(a.mediaWaveform, b.mediaWaveform) &&
    a.mediaCaption === b.mediaCaption &&
    a.mediaThumbUrl === b.mediaThumbUrl &&
    a.mediaPending === b.mediaPending &&
    a.mediaError === b.mediaError &&
    a.contactCard?.displayName === b.contactCard?.displayName &&
    a.contactCard?.phoneE164 === b.contactCard?.phoneE164 &&
    a.contactCard?.vcard === b.contactCard?.vcard &&
    a.isGroup === b.isGroup &&
    a.groupJid === b.groupJid &&
    a.senderJid === b.senderJid &&
    a.senderPhoneE164 === b.senderPhoneE164 &&
    a.senderName === b.senderName &&
    a.senderAvatarUrl === b.senderAvatarUrl &&
    a.quoted?.id === b.quoted?.id &&
    a.quoted?.body === b.quoted?.body &&
    a.quoted?.fromMe === b.quoted?.fromMe &&
    a.quoted?.remoteJid === b.quoted?.remoteJid &&
    a.quoted?.participant === b.quoted?.participant &&
    a.quoted?.senderName === b.quoted?.senderName &&
    a.quoted?.mediaType === b.quoted?.mediaType &&
    a.quoted?.mediaSeconds === b.quoted?.mediaSeconds &&
    a.systemKind === b.systemKind &&
    a.systemAction === b.systemAction &&
    a.waKey === b.waKey &&
    a.deliveryStatus === b.deliveryStatus &&
    a.mentionedJids === b.mentionedJids &&
    a.mentionedMe === b.mentionedMe
  );
}

export type MessagesSyncResult = {
  contacts: Contact[];
  chats: ChatPreview[];
  messages: Message[];
  nextSelectedChatId: string | null;
  nextSelectedContactId: string | null;
  /** 本批实际新增的入站消息（调用方通知/订单扫描用，避免全量重扫） */
  addedInbound: Message[];
};

/**
 * 纯函数：处理单条 bridge 事件的 messages.sync payload。
 * ensureContact 副作用通过 ContactIngestBag 回写。
 * 原子字段解析在 parseMessageItem，本文件只做跨消息的状态编排（回声/去重/enrich/预览）。
 */

export function applyMessagesSync(opts: {
  bag: ContactIngestBag;
  items: unknown[];
  payload: Record<string, unknown>;
  deviceId: string;
  selfName: string;
  eventTs?: number;
  /** 复制 messages 前的原数组，用于跨同步分块复用索引。 */
  sourceMessages?: Message[];
}): MessagesSyncResult {
  const object = ingestObject;
  const string = ingestString;
  const isInternalName = isInternalContactName;
  const { bag, items, payload, deviceId, selfName } = opts;
  let { contacts, chats, messages, nextSelectedChatId, nextSelectedContactId } =
    bag;

  const ensureContact = (item: Record<string, unknown>, devId: string) => {
    const c = ensureIngestContact(bag, item, devId, selfName);
    contacts = bag.contacts;
    chats = bag.chats;
    messages = bag.messages;
    nextSelectedChatId = bag.nextSelectedChatId;
    nextSelectedContactId = bag.nextSelectedContactId;
    return c;
  };
  // 本批实际新增的入站消息（供通知/订单扫描，避免调用方全量重扫）
  const addedInbound: Message[] = [];

    // 批内会话/联系人查找索引：替代逐条 chats.find/findIndex 全表扫描
    const chatLookup = createChatIdLookup();
    const findChatIdx = (id: string) => {
      const i = chatLookup.idx(chats, id);
      return i >= 0 &&
        (chats[i].accountId || chats[i].phoneId || deviceId) === deviceId
        ? i
        : -1;
    };
    const contactIdxById = (id: string) => {
      const i = bag._contactLookup?.idIndex(id) ?? -1;
      return i >= 0 ? i : contacts.findIndex((c) => c.id === id);
    };
    // 历史灌入 / 全量 snapshot 不当 live 未读；实时 upsert 才 +1
    const liveFlag = payload.live;
    const source = string(payload.source, 40);
    const treatAsLive =
      liveFlag === true ||
      (liveFlag !== false &&
        source !== "history" &&
        source !== "snapshot" &&
        source !== "sync");

    // 连续 history 分块复用索引；只有其它消息动作换了数组才重建一次。
    let syncIndex = reuseMessageSyncIndex(
      cachedMessageSyncIndex,
      opts.sourceMessages || messages
    );
    const ensureMsgIndex = () => syncIndex.byId;
    const ensureInByChat = () => syncIndex.inboundByChat;
    const invalidateMsgIndex = () => {
      syncIndex = createMessageSyncIndex(messages);
    };

    for (const raw of items) {
      const item = object(raw);
      if (!item) continue;

      const parsed = parseMessageItem(item, {
        deviceId,
        eventTs: opts.eventTs,
        messagesLength: messages.length,
      });
      if (!parsed) continue;

      // —— 表情回应：挂到原消息上，不新建气泡 ——
      if (parsed.isReaction) {
        // 兼容错误落库的「[表情] 👍」独立气泡：删掉它
        if (parsed.legacyBubbleBody && parsed.bogusId) {
          const before = messages.length;
          messages = messages.filter(
            (m) => !messageMatchesAccountAlias(m, deviceId, parsed.bogusId)
          );
          if (messages.length !== before) {
            invalidateMsgIndex();
          }
        }
        if (parsed.targetId) {
          const index = ensureMsgIndex();
          const idx =
            index.get(accountMessageIndexKey(deviceId, parsed.targetId)) ??
            index.get(parsed.targetId);
          if (idx != null && idx >= 0 && idx < messages.length) {
            const prev = messages[idx];
            if (prev.accountId && prev.accountId !== deviceId) continue;
            // 同一反应者只保留一个 emoji；不同人可共用同一 emoji
            let reactions = (prev.reactions || []).filter((r) => {
              const k =
                r.from === "me"
                  ? "me"
                  : r.participantJid
                    ? `m:${r.participantJid}`
                    : r.from === "member"
                      ? "m:?"
                      : "peer";
              return k !== parsed.reactorKey;
            });
            if (parsed.emoji) {
              reactions.push({
                emoji: parsed.emoji,
                from: parsed.from,
                participantJid:
                  parsed.from === "member" ? parsed.participantJid : undefined,
                participantName:
                  parsed.from === "member" ? parsed.participantName : undefined,
                at: new Date().toISOString(),
              });
            }
            // 仅当 reactions 实际变化才替换引用（避免击穿消息缓存导致气泡闪烁）
            const prevReactions = prev.reactions || [];
            const changed =
              reactions.length !== prevReactions.length ||
              reactions.some((r, i) => r !== prevReactions[i]);
            if (changed) messages[idx] = { ...prev, reactions };
          }
        }
        continue;
      }

      const messagesBeforeContact = messages;
      const contact = ensureContact(item, deviceId);
      if (messages !== messagesBeforeContact) invalidateMsgIndex();
      if (!contact) continue;
      const localChatId = `chat-${contact.id}`;
      const chatId =
        findChatIdx(localChatId) >= 0
          ? localChatId
          : `bridge-chat-${contact.id}`;
      const {
        direction,
        body,
        normBody,
        sentAt,
        sentTs,
        waId,
        localMessageId,
        mediaType,
        mediaUrl,
        mediaMime,
        mediaFileName,
        mediaSeconds,
        mediaPtt,
        mediaWaveform,
        mediaCaption,
        mediaThumbUrl,
        mediaPending,
        contactCard,
        hasMediaHint,
        isGroup: groupHint,
        groupJid,
        senderJid,
        senderPhoneE164,
        senderName,
        senderAvatarUrl,
        quoted,
        waKey,
        systemKind,
        systemAction,
        mentionedJids,
        mentionedMe,
      } = parsed;
      const isGroup = groupHint || contact.isGroup === true;

      // 出站回声：优先并回「当前选中会话」的乐观气泡，避免 WA 把回执挂到「自己/E」上拆会话
      if (direction === "out") {
        const echoTs = sentTs;
        const selectedChat = nextSelectedChatId;
        const selectedContact = nextSelectedContactId;
        // 出站回声匹配：必须在全部候选里挑「最优」，不能 findIndex 取第一条——
        // 同文案连发两条时，新气泡的回声会被更早、已回执的旧气泡抢走，
        // 新气泡永久停留在发送中（且可能被重试队列再捞出来重复发送）。
        // 优先级：精确 waMessageId > 未回执(pending>queued) > 已 sent；
        // 同级取时间离回声最近的。
        let localIdx = -1;
        let localBestRank = -1;
        let localBestDelta = Number.POSITIVE_INFINITY;
        for (let li = 0; li < messages.length; li++) {
          const m = messages[li];
          if (m.direction !== "out") continue;
          // 多号：禁止跨账号合并乐观气泡
          const mOwner = m.accountId || m.deviceId || "";
          if (mOwner && mOwner !== deviceId) continue;
          const mb = (m.body || "").replace(/\s+/g, " ").trim();
          if (mb !== normBody) continue;
          // 文本发送会写 waMessageId，媒体/旧版本有时只写 waKey.id；
          // 两者都代表同一个 WhatsApp 协议消息，必须优先合并回本地气泡。
          const exactId =
            !!waId && (m.waMessageId === waId || m.waKey?.id === waId);
          if (!exactId) {
            const sameThread =
              m.chatId === chatId ||
              m.chatId === selectedChat ||
              m.contactId === contact.id ||
              (!!selectedContact && m.contactId === selectedContact);
            if (!sameThread) continue;
            const localLike =
              String(m.id).startsWith("msg-") ||
              m.deliveryStatus === "pending" ||
              m.deliveryStatus === "queued" ||
              m.deliveryStatus === "sent";
            if (!localLike && !String(m.id).startsWith("bridge-msg-"))
              continue;
            const mt = Date.parse(m.sentAt);
            if (!Number.isFinite(mt) || !Number.isFinite(echoTs)) {
              if (!String(m.id).startsWith("msg-")) continue;
            } else if (Math.abs(echoTs - mt) >= 300_000) {
              continue;
            }
          }
          const mcT = Date.parse(m.sentAt);
          const delta =
            Number.isFinite(mcT) && Number.isFinite(echoTs)
              ? Math.abs(echoTs - mcT)
              : 0;
          const rank = exactId
            ? 4
            : m.deliveryStatus === "pending"
              ? 3
              : m.deliveryStatus === "queued"
                ? 2
                : 1;
          if (
            rank > localBestRank ||
            (rank === localBestRank && delta < localBestDelta)
          ) {
            localBestRank = rank;
            localBestDelta = delta;
            localIdx = li;
          }
        }
        if (localIdx >= 0) {
          const prev = messages[localIdx];
          // 始终留在用户正在聊的会话，不跟错误的 contact/E 跑
          const keepChatId = prev.chatId || selectedChat || chatId;
          const keepContactId =
            prev.contactId || selectedContact || contact.id;
          messages[localIdx] = {
            ...prev,
            waMessageId: waId || prev.waMessageId,
            sentAt: prev.sentAt || sentAt,
            // 回声只保证至少 sent，不降级已 delivered/read
            deliveryStatus:
              deliveryAckRank(prev.deliveryStatus) >= deliveryAckRank("sent")
                ? prev.deliveryStatus
                : "sent",
            lastError: undefined,
            nextAttemptAt: undefined,
            contactId: keepContactId,
            chatId: keepChatId,
            accountId: prev.accountId || deviceId,
            deviceId: prev.deviceId || deviceId,
          };
          setMessageIndexAlias(ensureMsgIndex(), deviceId, waId, localIdx);
          const chatIndex = findChatIdx(keepChatId);
          if (chatIndex >= 0) {
            const prevChat = chats[chatIndex];
            if (!prevChat.updatedAt || sentAt >= prevChat.updatedAt) {
              chats[chatIndex] = {
                ...prevChat,
                lastMessage: body,
                updatedAt: sentAt,
                unread: 0,
              };
            }
          }
          if (keepContactId) {
            const ci = contactIdxById(keepContactId);
            if (ci >= 0) {
              contacts[ci] = {
                ...contacts[ci],
                lastMessageAt: sentAt,
              };
            }
          }
          // 若本条被挂到「自己」联系人上，不要新建/更新那个幽灵会话
          if (
            looksLikeSelfContact(contact, selfName) &&
            keepChatId !== chatId
          ) {
            continue;
          }
          continue;
        }
      }

      // 入站：同 chat 近时同文案去重——只挡「完全重复」；有新媒体/键时交给后面 enrich
      if (direction === "in" && normBody) {
        const inTs = sentTs;
        // 只扫同 chat 的入站消息（语义与 messages.find 等价，避免全表 O(N)）
        let dupIn: Message | undefined;
        for (const idx of ensureInByChat().get(chatId) || []) {
          const m = messages[idx];
          if (!m) continue;
          if ((m.body || "").replace(/\s+/g, " ").trim() !== normBody)
            continue;
          if (m.id === waId || m.waMessageId === waId) {
            dupIn = m;
            break;
          }
          const t = Date.parse(m.sentAt);
          if (
            Number.isFinite(t) &&
            Number.isFinite(inTs) &&
            Math.abs(inTs - t) < 120_000
          ) {
            dupIn = m;
            break;
          }
        }
        // 已有正文且本条也无新媒体线索 → 真重复
        if (
          dupIn &&
          !hasMediaHint &&
          !item.waKey &&
          !item.key &&
          (dupIn.mediaUrl || !string(item.mediaUrl ?? item.mediaDataUrl, 20))
        ) {
          continue;
        }
      }
      const idxMap = ensureMsgIndex();
      let existingIdx = -1;
      for (const key of [localMessageId, waId, string(item.targetMessageId, 300)]) {
        if (!key) continue;
        const at = idxMap.get(key);
        if (at == null) continue;
        const cand = messages[at];
        if (cand && cand.chatId === chatId) {
          existingIdx = at;
          break;
        }
      }
      if (existingIdx >= 0) {
        const prev = messages[existingIdx];
        const next = {
          ...prev,
          body: body || prev.body,
          mediaType: mediaType || prev.mediaType,
          mediaUrl: mediaUrl || prev.mediaUrl,
          mediaMime: mediaMime || prev.mediaMime,
          mediaFileName: mediaFileName || prev.mediaFileName,
          mediaSeconds: mediaSeconds ?? prev.mediaSeconds,
          mediaPtt: mediaPtt || prev.mediaPtt,
          mediaWaveform: mediaWaveform?.length ? mediaWaveform : prev.mediaWaveform,
          mediaCaption: mediaCaption || prev.mediaCaption,
          mediaThumbUrl: mediaThumbUrl || prev.mediaThumbUrl,
          mediaPending: mediaUrl || prev.mediaUrl ? false : mediaPending || prev.mediaPending,
          mediaError: mediaUrl ? undefined : prev.mediaError,
          contactCard: contactCard || prev.contactCard,
          isGroup: isGroup || prev.isGroup,
          groupJid: groupJid || prev.groupJid,
          senderJid: senderJid || prev.senderJid,
          senderPhoneE164: senderPhoneE164 || prev.senderPhoneE164,
          senderName: senderName || prev.senderName,
          senderAvatarUrl: senderAvatarUrl || prev.senderAvatarUrl,
          quoted: quoted || prev.quoted,
          systemKind:
            (typeof systemKind === "string" && systemKind) ||
            prev.systemKind,
          systemAction:
            (typeof systemAction === "string" && systemAction) ||
            prev.systemAction,
          mentionedJids: Array.isArray(mentionedJids)
            ? mentionedJids
            : prev.mentionedJids,
          mentionedMe: mentionedMe || prev.mentionedMe,
          waKey: waKey || prev.waKey,
          // 本地星标不被 bridge 回声覆盖
          starred: prev.starred,
          starredAt: prev.starredAt,
          // enrich 禁止把 delivered/read 打回 sent
          deliveryStatus:
            direction === "out"
              ? deliveryAckRank(prev.deliveryStatus) >= deliveryAckRank("sent")
                ? prev.deliveryStatus
                : "sent"
              : prev.deliveryStatus,
        };
        // 内容未变则不替换引用：避免击穿 selectChatMessages 缓存 → 全部气泡重渲染闪烁
        if (!shallowMessageSame(prev, next)) {
          messages[existingIdx] = next;
        }
        if (waId) ensureMsgIndex().set(waId, existingIdx);
        if (waKey?.id) ensureMsgIndex().set(waKey.id, existingIdx);
        continue;
      }

      const newIdx = messages.length;
      messages.push({
        id: localMessageId,
        chatId,
        accountId: deviceId,
        direction,
        body,
        sentAt,
        deliveryStatus: direction === "out" ? "sent" : undefined,
        waMessageId: waId,
        waKey,
        contactId: contact.id,
        deviceId,
        isGroup,
        groupJid: isGroup ? groupJid : undefined,
        senderJid: isGroup ? senderJid : undefined,
        senderPhoneE164: isGroup ? senderPhoneE164 : undefined,
        senderName: isGroup ? senderName : undefined,
        senderAvatarUrl: isGroup ? senderAvatarUrl : undefined,
        quoted,
        systemKind:
          typeof systemKind === "string" ? systemKind : undefined,
        systemAction:
          typeof systemAction === "string" ? systemAction : undefined,
        mentionedJids,
        mentionedMe,
        mediaType: mediaType || undefined,
        mediaUrl: mediaUrl || undefined,
        mediaMime: mediaMime || undefined,
        mediaFileName: mediaFileName || undefined,
        mediaSeconds,
        mediaPtt: mediaPtt || undefined,
        mediaWaveform: mediaWaveform?.length ? mediaWaveform : undefined,
        mediaCaption: mediaCaption || undefined,
        mediaThumbUrl: mediaThumbUrl || undefined,
        mediaPending: mediaUrl ? false : mediaPending || undefined,
        contactCard,
      });
      if (direction === "in") {
        addedInbound.push(messages[newIdx]!);
        // 增量维护同 chat 入站列表（仅已建过时）
        const byChat = ensureInByChat();
        const list = byChat.get(chatId);
        if (list) list.push(newIdx);
        else byChat.set(chatId, [newIdx]);
      }
      try {
        noteTrendMessage({
          direction,
          sentAt,
          chatId,
          accountId: deviceId,
        });
      } catch {
        /* ignore */
      }
      // 增量维护批内索引（仅在已建过 index 时更新，避免无反应批白建 Map）
      const ix = ensureMsgIndex();
      if (localMessageId) ix.set(localMessageId, newIdx);
      if (waId) ix.set(waId, newIdx);
      const keyId = waKey?.id;
      if (keyId) ix.set(keyId, newIdx);

      const chatIndex = findChatIdx(chatId);
      // 正在看的会话不涨未读；历史/snapshot 不涨
      const bumpUnread =
        treatAsLive &&
        direction === "in" &&
        nextSelectedChatId !== chatId &&
        source !== "enrich";
      const unread = bumpUnread ? 1 : 0;
      const incomingName = string(
        item.displayName ?? item.pushName ?? item.notify,
        200
      );
      const resolvedName =
        incomingName && !isInternalName(incomingName)
          ? incomingName
          : contact.name && !isInternalName(contact.name)
            ? contact.name
            : "";

      // 真名写回联系人（历史/实时）
      if (resolvedName) {
        const ci = contactIdxById(contact.id);
        if (ci >= 0 && isInternalName(contacts[ci].name)) {
          contacts[ci] = { ...contacts[ci], name: resolvedName };
        }
      }

      const titleName =
        resolvedName ||
        (contact.name && !isInternalName(contact.name)
          ? contact.name
          : "") ||
        contact.phone ||
        "";

      const isSystemMsg =
        mediaType === "system" ||
        (typeof systemKind === "string" && !!systemKind);
      const conversationOutgoing = isConversationOutgoing({
        direction,
        mediaType,
        deliveryStatus: direction === "out" ? "sent" : undefined,
      });
      // 系统消息（踢人/进群等）可更新预览文案，但 updatedAt 只跟真人说话走（对齐「最近消息」）
      const chat: ChatPreview = {
        id: chatId,
        contactId: contact.id,
        contactName: titleName,
        lastMessage:
          isGroup && direction === "in" && senderName && !isSystemMsg
            ? `${senderName}: ${body}`
            : body,
        lastMessageDirection: isSystemMsg ? undefined : direction,
        unread: (chats[chatIndex]?.unread ?? 0) + unread,
        // 仅真实聊天推进列表时间；系统事件用旧值或 sentAt 仅作新建兜底
        updatedAt: isSystemMsg
          ? chats[chatIndex]?.updatedAt || sentAt
          : sentAt,
        phoneId: deviceId,
        accountId: deviceId,
        isGroup,
        hasOutgoingHistory:
          chats[chatIndex]?.hasOutgoingHistory || conversationOutgoing,
      };
      if (chatIndex >= 0) {
        const prev = chats[chatIndex];
        const newer =
          !isSystemMsg &&
          (!prev.updatedAt || sentAt >= prev.updatedAt || bumpUnread);
        const keepName =
          (titleName && !isInternalName(titleName) ? titleName : "") ||
          (prev.contactName && !isInternalName(prev.contactName)
            ? prev.contactName
            : titleName || prev.contactName);
        // 未读只在 newer 或 bump 时累加，避免旧 history 重放把未读清掉/乱加
        const nextUnread = bumpUnread
          ? (prev.unread ?? 0) + 1
          : newer
            ? direction === "out"
              ? 0
              : prev.unread ?? 0
            : prev.unread ?? 0;
        chats[chatIndex] = newer
          ? {
              ...chat,
              contactName: keepName,
              unread: nextUnread,
              lastMessageDirection: isSystemMsg
                ? prev.lastMessageDirection
                : direction,
              // 真实消息：列表时间必须跟上
              updatedAt: sentAt,
            }
          : {
              ...prev,
              contactName: keepName,
              phoneId: deviceId,
              accountId: prev.accountId || deviceId,
              unread: nextUnread,
              // 系统事件：可刷预览，严禁抬高 updatedAt
              updatedAt: prev.updatedAt,
              lastMessage:
                isSystemMsg && body
                  ? body
                  : prev.lastMessage || chat.lastMessage,
              isGroup: isGroup || prev.isGroup,
              hasOutgoingHistory:
                prev.hasOutgoingHistory || conversationOutgoing,
            };
      } else {
        chats.push(chat);
      }

      const cIdx = contactIdxById(contact.id);
      if (cIdx >= 0 && !isSystemMsg) {
        const prevAt = contacts[cIdx].lastMessageAt;
        if (!prevAt || sentAt >= prevAt) {
          contacts[cIdx] = {
            ...contacts[cIdx],
            lastMessageAt: sentAt,
          };
        }
      }
    }

  bag.contacts = contacts;
  bag.chats = chats;
  bag.messages = messages;
  bag.nextSelectedChatId = nextSelectedChatId;
  bag.nextSelectedContactId = nextSelectedContactId;
  cachedMessageSyncIndex = { ...syncIndex, source: messages };
  return {
    contacts,
    chats,
    messages,
    nextSelectedChatId,
    nextSelectedContactId,
    addedInbound,
  };
}
