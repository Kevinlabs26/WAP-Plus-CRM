import type { AppState, SliceContext } from "./types";
import {
  applyMessagesAck,
  ingestObject,
  ingestString,
} from "./bridgeIngestHelpers";
import { applyPresenceUpdate } from "./presenceIngest";
import { applyDeviceHello, applyDeviceStatus } from "./deviceIngest";
import { applyContactsSync } from "./contactIngest";
import { applyMessagesSync } from "./messagesIngest";
import { applyMessagesDelete } from "./messagesDeleteIngest";
import { applyChatsDelete } from "./chatsDeleteIngest";
import {
  applyBlocklistUpdate,
  mergeBlocklistJids,
} from "./blocklistIngest";
import {
  getAccountBlocklist,
  resolveWaMetaAccountId,
  setAccountBlocklist,
  setAccountHistoryNote,
} from "@/lib/accountWaMeta";
import { applyOrderAutomation } from "./orderAutomation";
import { applyFollowUpAutomation } from "./followUpAutomation";
import type { Message } from "@/types/crm";
import {
  backfillChatPreviewFromMessages,
  reconcileChatsForContacts,
} from "./chatReconcile";
import { mergeImportedContactChatDuplicates } from "./chatDuplicateMerge";
import { pruneChatFolderRefs } from "./chatFolderCleanup";
import { resolveFollowUpRules } from "@/lib/followUpRules";
import {
  bridgeMessageMediaCacheId,
  cacheMediaUrl,
} from "@/lib/mediaCache";
import {
  clearStoredRemoteMessages,
  deleteStoredMessagesByKeys,
} from "@/lib/storage";
import { noteMainThreadWork, syncLog } from "@/lib/syncDebug";
import { isComposerTypingBusy } from "@/lib/composerActivity";
import type { BridgeEvent } from "@/lib/bridge";
import { persist, scheduleStatsRecompute } from "./persist";
import { notifyInboundMessages, type InboundNotifyItem } from "@/lib/inboundMessageNotify";
import { emitLiveInboundMessages } from "@/lib/aiAutoReply";
import { needsFullMessageReconcile } from "./messageReconcilePolicy";

/**
 * 单次同步 set() 的 item 预算：超出则切块、块间让出主线程，避免一次 ingest
 * 全量克隆 + 逐条查找占满主线程（历史同步一次 100ms+ 就是打字卡顿的根因）。
 */
const INGEST_SLICE_ITEMS = 60;
const INGEST_SLICE_EVENTS = 40;
const INGEST_SLICE_RETRY_MS = 120;

function sliceIngestEvents(events: BridgeEvent[]): BridgeEvent[][] {
  const slices: BridgeEvent[][] = [];
  let current: BridgeEvent[] = [];
  let currentItems = 0;
  const flush = () => {
    if (!current.length) return;
    slices.push(current);
    current = [];
    currentItems = 0;
  };
  // 不能给事件数设置硬上限：全量历史同步可能超过 2000 个事件，
  // 截断会让消息记录永久缺失。下面按事件和 item 分片，并在块之间让出主线程。
  for (const event of events) {
    const payload = ingestObject(event.payload) ?? {};
    const rawItems = Array.isArray(payload.items) ? payload.items : null;
    if (rawItems && rawItems.length > INGEST_SLICE_ITEMS) {
      // 单个大事件也切块：每片 ≤ INGEST_SLICE_ITEMS 个 item。
      // syncBatchFinal 只保留在最后一片，避免中途触发全量 reconcile（语义不变）。
      flush();
      const n = rawItems.length;
      for (let start = 0; start < n; start += INGEST_SLICE_ITEMS) {
        const items = rawItems.slice(start, start + INGEST_SLICE_ITEMS);
        const last = start + INGEST_SLICE_ITEMS >= n;
        const syncBatchFinal = last ? payload.syncBatchFinal : false;
        slices.push([
          {
            ...event,
            payload: {
              ...payload,
              items,
              ...(payload.syncBatchFinal !== undefined
                ? { syncBatchFinal }
                : {}),
            },
          },
        ]);
      }
      continue;
    }
    const cost = Math.max(1, rawItems ? rawItems.length : 1);
    if (
      current.length &&
      (current.length >= INGEST_SLICE_EVENTS ||
        currentItems + cost > INGEST_SLICE_ITEMS)
    ) {
      flush();
    }
    current.push(event);
    currentItems += cost;
  }
  flush();
  return slices;
}

/**
 * 需要预克隆的集合：applyContactsSync / applyMessagesSync 会原地改写 contacts/chats/messages；
 * 其它集合（phones/followUps/activities）的辅助函数都是 copy-on-write，未改动时保持 state 引用。
 */
function ingestTouchSet(
  events: BridgeEvent[]
): Set<"contacts" | "chats" | "messages"> {
  const touch = new Set<"contacts" | "chats" | "messages">();
  for (const event of events) {
    if (event.type === "messages.sync") {
      touch.add("contacts");
      touch.add("chats");
      touch.add("messages");
    } else if (event.type === "contacts.sync") {
      touch.add("contacts");
      touch.add("chats");
    }
  }
  return touch;
}

export function createIngestSlice({
  set,
  get,
}: SliceContext): Pick<AppState, "ingestBridgeEvents"> {
  return {
    ingestBridgeEvents: (events) => {
      if (!events.length) return;
      const ingestStarted = performance.now();
      for (const event of events) {
        const payload = ingestObject(event.payload) ?? {};
        const ownerAccountId =
          ingestString(
            (event as { accountId?: string }).accountId ??
              payload.accountId ??
              event.deviceId ??
              payload.id ??
              payload.deviceId,
            200
          ) || "android-bridge";
        const items = Array.isArray(payload.items) ? payload.items : [];
        for (const item of items) {
          const mediaUrl = ingestString(item.mediaUrl, 5_000_000);
          if (!mediaUrl) continue;
          const targetId = ingestString(item.targetMessageId, 300);
          const rawId = ingestString(item.id, 300);
          const id =
            targetId ||
            (event.type === "messages.sync"
              ? bridgeMessageMediaCacheId(rawId, ownerAccountId)
              : rawId);
          if (id) void cacheMediaUrl(id, mediaUrl);
        }
      }

      // presence 很密：只 patch 窄字段，禁止克隆 phones/contacts/chats/messages
      const onlyPresence =
        events.length > 0 &&
        events.every((e) => e.type === "presence.update");
      if (onlyPresence) {
        set((state) => {
          let peerPresenceByKey = state.peerPresenceByKey;
          let changed = false;
          for (const event of events.slice(0, 200)) {
            const payload = ingestObject(event.payload) ?? {};
            const items = Array.isArray(payload.items)
              ? payload.items.slice(0, 100)
              : [];
            if (!items.length) continue;
            const next = applyPresenceUpdate(peerPresenceByKey, {
              contacts: state.contacts,
              chats: state.chats,
              selectedChatId: state.selectedChatId,
              selectedContactId: state.selectedContactId,
              items,
            });
            if (next !== peerPresenceByKey) {
              peerPresenceByKey = next;
              changed = true;
            }
          }
          return changed ? { peerPresenceByKey } : state;
        });
        return;
      }

      let ingestChanged = false;
      const clearedRemoteTargets = new Map<
        string,
        { remoteJid: string; accountId: string }
      >();
      const deletedRemoteMessageKeys = new Map<string, Set<string>>();
      // 本批新增入站消息（用于桌面通知，set 之外触发）
      let inboundNotifies: InboundNotifyItem[] | null = null;
      // 本批实时新增入站消息（用于 AI 自动回复，仅 live 不收集历史回填）
      let liveInboundForAuto: Message[] | null = null;
      // —— 大批次切成小块，块间让出主线程（打字时再延后），避免一次 set 卡 100ms+ ——
      const slices = sliceIngestEvents(events);
      const runSlice = (sliceEvents: BridgeEvent[]) => {
        const shouldReconcileAllMessages = needsFullMessageReconcile(sliceEvents);
        // 只克隆会被原地改写的数组（applyContactsSync/applyMessagesSync 是唯一原地变更方）；
        // 其它数组走 copy-on-write 辅助函数，未改动时保持 state 引用，避免每批全量克隆。
        const touch = ingestTouchSet(sliceEvents);
        set((state) => {
        let phones = state.phones;
        let contacts = touch.has("contacts") ? [...state.contacts] : state.contacts;
        let chats = touch.has("chats") ? [...state.chats] : state.chats;
        let messages = touch.has("messages") ? [...state.messages] : state.messages;
        let messageIndexSource = state.messages;
        let followUps = state.followUps;
        let activities = state.activities;
        let peerPresenceByKey = state.peerPresenceByKey;
        let nextSelectedChatId = state.selectedChatId;
        let nextSelectedContactId = state.selectedContactId;

        const string = ingestString;
        const object = ingestObject;
        const selfName = (() => {
          const n = (state.baileysUi?.userName || "").trim();
          return n && n.length <= 40 ? n : "";
        })();
        const contactBag = {
          contacts,
          chats,
          messages,
          nextSelectedChatId,
          nextSelectedContactId,
        };

        for (const event of sliceEvents) {
          const payload = object(event.payload) ?? {};
          // 多号：归属优先 accountId（事件/payload），避免全进 "baileys"
          const ownerAccountId =
            string(
              (event as { accountId?: string }).accountId ??
                payload.accountId ??
                event.deviceId ??
                payload.id ??
                payload.deviceId,
              200
            ) || "android-bridge";
          const deviceId = ownerAccountId;

          if (event.type === "device.hello") {
            phones = applyDeviceHello(phones, deviceId, payload);
            continue;
          }

          if (event.type === "device.status" || event.type === "device.battery") {
            phones = applyDeviceStatus(phones, deviceId, payload);
            continue;
          }

          const items = Array.isArray(payload.items)
            ? payload.items.slice(0, 500)
            : [];
          if (event.type === "contacts.sync") {
            contactBag.contacts = contacts;
            contactBag.chats = chats;
            contactBag.messages = messages;
            contactBag.nextSelectedChatId = nextSelectedChatId;
            contactBag.nextSelectedContactId = nextSelectedContactId;
            applyContactsSync(
              contactBag,
              items,
              ownerAccountId,
              selfName,
              typeof event.ts === "number" ? event.ts : undefined,
              payload.syncBatchFinal !== false
            );
            contacts = contactBag.contacts;
            chats = contactBag.chats;
            messages = contactBag.messages;
            nextSelectedChatId = contactBag.nextSelectedChatId;
            nextSelectedContactId = contactBag.nextSelectedContactId;
            continue;
          }
          // 混在其它事件批里的 presence：只更新 map，不克隆大数组
          if (event.type === "presence.update") {
            peerPresenceByKey = applyPresenceUpdate(peerPresenceByKey, {
              contacts,
              chats,
              selectedChatId: state.selectedChatId,
              selectedContactId: state.selectedContactId,
              items,
            });
            continue;
          }
          if (event.type === "messages.delete") {
            if (payload.all && typeof payload.jid === "string" && payload.jid) {
              clearedRemoteTargets.set(`${deviceId}\0${payload.jid}`, {
                remoteJid: payload.jid,
                accountId: deviceId,
              });
            }
            if (Array.isArray(payload.items)) {
              for (const item of payload.items) {
                if (!item || typeof item !== "object") continue;
                const id = (item as { id?: unknown }).id;
                if (typeof id === "string" && id.trim()) {
                  let keys = deletedRemoteMessageKeys.get(deviceId);
                  if (!keys) {
                    keys = new Set<string>();
                    deletedRemoteMessageKeys.set(deviceId, keys);
                  }
                  keys.add(id.trim());
                }
              }
            }
            const del = applyMessagesDelete(messages, chats, payload as never, {
              deviceId,
            });
            messages = del.messages;
            chats = del.chats;
            continue;
          }
          if (event.type === "chats.delete") {
            const jids = Array.isArray((payload as { jids?: string[] }).jids)
              ? ((payload as { jids: string[] }).jids || [])
              : [];
            const out = applyChatsDelete(
              chats,
              messages,
              contacts,
              jids,
              ownerAccountId || deviceId
            );
            chats = out.chats;
            messages = out.messages;
            if (out.clearedSelection) {
              if (
                nextSelectedChatId &&
                !chats.some((c) => c.id === nextSelectedChatId)
              ) {
                nextSelectedChatId = null;
              }
            }
            continue;
          }
          if (event.type === "blocklist.sync") {
            const jids = Array.isArray((payload as { jids?: string[] }).jids)
              ? ((payload as { jids: string[] }).jids || [])
              : [];
            const aid = resolveWaMetaAccountId(ownerAccountId || deviceId, {
              liveBaileysAccountId: state.settings.liveBaileysAccountId,
              activeAccountId: state.settings.activeAccountId,
              deviceId,
            });
            (
              contactBag as { _blocklist?: string[]; _blocklistAccountId?: string }
            )._blocklist = mergeBlocklistJids(undefined, jids);
            (
              contactBag as { _blocklistAccountId?: string }
            )._blocklistAccountId = aid;
            continue;
          }
          if (event.type === "blocklist.update") {
            const jids = Array.isArray((payload as { jids?: string[] }).jids)
              ? ((payload as { jids: string[] }).jids || [])
              : [];
            const typ = String((payload as { type?: string }).type || "add");
            const aid = resolveWaMetaAccountId(ownerAccountId || deviceId, {
              liveBaileysAccountId: state.settings.liveBaileysAccountId,
              activeAccountId: state.settings.activeAccountId,
              deviceId,
            });
            const prev =
              (contactBag as { _blocklist?: string[] })._blocklist ||
              getAccountBlocklist(
                state.settings.blocklistByAccountId,
                aid,
                state.settings.blocklistJids
              );
            (
              contactBag as { _blocklist?: string[]; _blocklistAccountId?: string }
            )._blocklist = applyBlocklistUpdate(prev, jids, typ);
            (
              contactBag as { _blocklistAccountId?: string }
            )._blocklistAccountId = aid;
            continue;
          }
          if (event.type === "history.sync_status") {
            const st = String((payload as { status?: string }).status || "");
            const note =
              st === "complete"
                ? "历史同步完成"
                : st === "paused"
                  ? "历史同步暂停/等待"
                  : st
                    ? `历史同步：${st}`
                    : "";
            if (note) {
              const aid = resolveWaMetaAccountId(ownerAccountId || deviceId, {
                liveBaileysAccountId: state.settings.liveBaileysAccountId,
                activeAccountId: state.settings.activeAccountId,
                deviceId,
              });
              (
                contactBag as {
                  _historyNote?: string;
                  _historyAccountId?: string;
                }
              )._historyNote = note;
              (
                contactBag as { _historyAccountId?: string }
              )._historyAccountId = aid;
            }
            continue;
          }
          // 出站回执：送达 / 已读
          if (event.type === "messages.ack") {
            messages = applyMessagesAck(messages, items, undefined, deviceId);
            continue;
          }

          if (event.type === "messages.sync") {
            contactBag.contacts = contacts;
            contactBag.chats = chats;
            contactBag.messages = messages;
            contactBag.nextSelectedChatId = nextSelectedChatId;
            contactBag.nextSelectedContactId = nextSelectedContactId;
            const syncRes = applyMessagesSync({
              bag: contactBag,
              items,
              payload,
              deviceId,
              selfName,
              eventTs: typeof event.ts === "number" ? event.ts : undefined,
              sourceMessages: messageIndexSource,
            });
            contacts = contactBag.contacts;
            chats = contactBag.chats;
            messages = contactBag.messages;
            messageIndexSource = messages;
            nextSelectedChatId = contactBag.nextSelectedChatId;
            nextSelectedContactId = contactBag.nextSelectedContactId;
            // 本批新增入站消息（applyMessagesSync 内部增量收集，免全量重扫）
            const addedInbound = syncRes.addedInbound;
            if (payload.live === true && addedInbound.length) {
              liveInboundForAuto = liveInboundForAuto || [];
              liveInboundForAuto.push(...addedInbound);
            }
            // 收集新增入站消息 → 桌面通知（在 set 之外触发，避免副作用）
            if (payload.live === true && addedInbound.length) {
              const contactNameById = new Map(
                contacts.map((c) => [c.id, c])
              );
              const unreadByChatId = new Map(
                chats.map((chat) => [chat.id, chat.unread || 0])
              );
              for (const m of addedInbound) {
                if (m.isGroup && !m.senderName) continue;
                const c = m.contactId ? contactNameById.get(m.contactId) : undefined;
                inboundNotifies = inboundNotifies || [];
                inboundNotifies.push({
                  messageId: m.id,
                  chatId: m.chatId,
                  contactId: m.contactId,
                  contactName: c?.name || m.senderName || "",
                  senderName: m.isGroup ? m.senderName : undefined,
                  avatarUrl: c?.avatarUrl,
                  unreadCount: unreadByChatId.get(m.chatId),
                  body: m.body || "",
                  accountId: deviceId,
                  isGroup: m.isGroup,
                });
              }
            }
            if (payload.live === true) {
              const newOrders = addedInbound.filter(
                (message) => message.mediaType === "order"
              );
              if (newOrders.length) {
                const automated = applyOrderAutomation(
                  contacts,
                  followUps,
                  activities,
                  newOrders
                );
                contacts = automated.contacts;
                followUps = automated.followUps;
                activities = automated.activities;
                contactBag.contacts = contacts;
              }
            }
            continue;
          }
        }


        // 未回/超时 → 自动跟进（仅本批含消息类事件时跑，避免 presence 拖垮）
        const shouldAutoFollow = shouldReconcileAllMessages;
        if (shouldAutoFollow && state.settings.autoFollowUpEnabled !== false) {
          try {
            const fu = applyFollowUpAutomation({
              contacts,
              messages,
              followUps,
              rules: resolveFollowUpRules(state.settings.followUpRuleSettings),
            });
            followUps = fu.followUps;
            contacts = fu.contacts;
          } catch {
            /* ignore automation errors */
          }
        }

        const mergedLocalChats = shouldReconcileAllMessages
          ? mergeImportedContactChatDuplicates(
              chats,
              messages,
              nextSelectedChatId
            )
          : null;
        if (mergedLocalChats?.changed) {
          chats = mergedLocalChats.chats;
          messages = mergedLocalChats.messages;
          nextSelectedChatId = mergedLocalChats.selectedChatId ?? null;
        }

        // 会话清理 + 标题回填（有消息/预览/未读/钉选/有效联系人则保留）
        if (shouldReconcileAllMessages) {
          chats = reconcileChatsForContacts(chats, messages, contacts);
        }

        if (
          nextSelectedChatId &&
          !chats.some((c) => c.id === nextSelectedChatId)
        ) {
          nextSelectedChatId = null;
        }

        const blocklist =
          (contactBag as { _blocklist?: string[]; _blocklistAccountId?: string })
            ._blocklist;
        // ownerAccountId/deviceId 只在 for 循环内；循环后用 stash 或 settings 回退
        const blocklistAccountId =
          (contactBag as { _blocklistAccountId?: string })._blocklistAccountId ||
          resolveWaMetaAccountId(null, {
            liveBaileysAccountId: state.settings.liveBaileysAccountId,
            activeAccountId: state.settings.activeAccountId,
          });
        const historyNote =
          (contactBag as { _historyNote?: string })._historyNote;
        const historyAccountId =
          (contactBag as { _historyAccountId?: string })._historyAccountId ||
          blocklistAccountId;

        let settingsPatch: Record<string, unknown> | null = null;
        if (mergedLocalChats?.changed) {
          const folderRefs = pruneChatFolderRefs(
            state.settings.chatFolders || [],
            state.settings.chatFolderClones || [],
            new Set(chats.map((chat) => chat.id)),
            mergedLocalChats.replacements
          );
          if (folderRefs.changed) {
            settingsPatch = {
              chatFolders: folderRefs.folders,
              chatFolderClones: folderRefs.clones,
            };
          }
        }
        if (blocklist) {
          const byAcc = setAccountBlocklist(
            state.settings.blocklistByAccountId,
            blocklistAccountId,
            blocklist
          );
          const liveId =
            state.settings.liveBaileysAccountId ||
            state.settings.activeAccountId ||
            "";
          settingsPatch = {
            ...(settingsPatch || {}),
            blocklistByAccountId: byAcc,
            blocklistJids:
              blocklistAccountId === liveId
                ? blocklist
                : state.settings.blocklistJids,
          };
        }
        if (historyNote) {
          const byHn = setAccountHistoryNote(
            state.settings.historySyncNoteByAccountId,
            historyAccountId,
            historyNote
          );
          const liveId =
            state.settings.liveBaileysAccountId ||
            state.settings.activeAccountId ||
            "";
          settingsPatch = {
            ...(settingsPatch || {}),
            historySyncNoteByAccountId: byHn,
            historySyncNote:
              historyAccountId === liveId
                ? historyNote
                : state.settings.historySyncNote,
          };
        }

        // 选中态：只在明确 next* 时切换；禁止回退到 contacts[0]/chats[0]
        // （否则同步/入库会把用户正在看的会话拽走，像「列表乱跳/空白」）
        let selContact =
          nextSelectedContactId !== undefined && nextSelectedContactId !== null
            ? nextSelectedContactId
            : state.selectedContactId;
        let selChat =
          nextSelectedChatId !== undefined && nextSelectedChatId !== null
            ? nextSelectedChatId
            : state.selectedChatId;
        if (selChat && !chats.some((c) => c.id === selChat)) selChat = null;
        if (selContact && !contacts.some((c) => c.id === selContact))
          selContact = null;
        // 若仍有选中会话，补齐 contact
        if (selChat && !selContact) {
          selContact = chats.find((c) => c.id === selChat)?.contactId ?? null;
        }

        // 用消息库回填会话预览时间（对齐官方排序，修复陈旧 updatedAt）
        if (shouldReconcileAllMessages) {
          try {
            chats = backfillChatPreviewFromMessages(chats, messages);
          } catch {
            /* ignore reconcile */
          }
        }

        if (
          contacts.length === state.contacts.length &&
          contacts.every((contact, index) => contact === state.contacts[index])
        ) {
          contacts = state.contacts;
        }
        if (
          chats.length === state.chats.length &&
          chats.every((chat, index) => chat === state.chats[index])
        ) {
          chats = state.chats;
        }

        const sameRefs = <T>(a: T[], b: T[]) =>
          a.length === b.length && a.every((item, index) => item === b[index]);        if (sameRefs(phones, state.phones)) phones = state.phones;
        if (sameRefs(messages, state.messages)) messages = state.messages;
        if (sameRefs(followUps, state.followUps)) followUps = state.followUps;
        if (sameRefs(activities, state.activities)) activities = state.activities;
        const nextSelectedPhoneId = state.selectedPhoneId ?? phones[0]?.id ?? null;
        if (
          phones === state.phones &&
          contacts === state.contacts &&
          chats === state.chats &&
          messages === state.messages &&
          followUps === state.followUps &&
          activities === state.activities &&
          peerPresenceByKey === state.peerPresenceByKey &&
          nextSelectedPhoneId === state.selectedPhoneId &&
          selContact === state.selectedContactId &&
          selChat === state.selectedChatId &&
          !settingsPatch
        ) {
          return state;
        }
        ingestChanged = true;

        return {
          phones,
          contacts,
          chats,
          messages,
          followUps,
          activities,
          peerPresenceByKey,
          selectedPhoneId: nextSelectedPhoneId,
          selectedContactId: selContact,
          selectedChatId: selChat,
          ...(settingsPatch
            ? {
                settings: {
                  ...state.settings,
                  ...settingsPatch,
                },
              }
            : {}),
        };
      });
      };

      // 全部块跑完后统一收尾（通知 / 统计 / 落盘），只跑一次
      const finish = () => {
        for (const target of clearedRemoteTargets.values()) {
          void clearStoredRemoteMessages(target.remoteJid, target.accountId).catch((error) =>
            get().pushToast(
              error instanceof Error ? error.message : "聊天记录清空落盘失败",
              "error"
            )
          );
        }
        for (const [accountId, keys] of deletedRemoteMessageKeys) {
          void deleteStoredMessagesByKeys([...keys], accountId).catch(
            (error) =>
              get().pushToast(
                error instanceof Error ? error.message : "消息删除落盘失败",
                "error"
              )
          );
        }
        if (!ingestChanged) return;
        // 桌面通知（入站新消息）：复用已入库的 chats 构建静音表
        const notifyItems: InboundNotifyItem[] = inboundNotifies
          ? inboundNotifies
          : [];
        if (notifyItems.length) {
          const st = get();
          const mutedUntilByChatId: Record<string, number | null | undefined> = {};
          for (const ch of st.chats) {
            if (ch.mutedUntil) mutedUntilByChatId[ch.id] = ch.mutedUntil;
          }
          notifyInboundMessages(notifyItems, {
            selectedChatId: st.selectedChatId,
            mutedUntilByChatId,
            enabled: st.settings.desktopNotifyEnabled !== false,
            groupMessagesEnabled: st.settings.notifyGroupMessagesEnabled === true,
            openChat: ({ chatId, contactId, messageId }) => {
              const a = get();
              a.setActiveNav("chats");
              if (contactId) {
                a.openContactWorkspace(contactId, {
                  focusMessageId: messageId || undefined,
                });
              } else if (chatId) {
                a.setSelectedChat(chatId);
              }
            },
          });
        }
        if (liveInboundForAuto?.length) {
          emitLiveInboundMessages(liveInboundForAuto);
        }
        scheduleStatsRecompute(get);
        const hasDurableMessageChange = events.some((event) =>
          event.type === "messages.sync" ||
          event.type === "messages.delete" ||
          event.type === "messages.ack" ||
          event.type === "chats.delete"
        );
        if (hasDurableMessageChange) persist(get, false, 6000);
        const messageItems = events.reduce((count, event) => {
          const payload = ingestObject(event.payload) ?? {};
          return count + (Array.isArray(payload.items) ? payload.items.length : 0);
        }, 0);
        const durationMs = Math.round(performance.now() - ingestStarted);
        noteMainThreadWork("bridge ingest", ingestStarted);
        if (durationMs >= 16 || messageItems >= 50) {
          syncLog(
            "ingest",
            "bridge batch",
            { events: events.length, items: messageItems, durationMs },
            durationMs >= 80 ? "warn" : "debug"
          );
        }
      };

      if (slices.length <= 1) {
        runSlice(slices[0] ?? events);
        finish();
        return;
      }
      // 先同步跑第一块，其余块让出主线程；打字进行中则顺延
      runSlice(slices[0]);
      let sliceIdx = 1;
      const step = () => {
        if (sliceIdx >= slices.length) {
          finish();
          return;
        }
        if (isComposerTypingBusy()) {
          window.setTimeout(step, INGEST_SLICE_RETRY_MS);
          return;
        }
        runSlice(slices[sliceIdx]);
        sliceIdx += 1;
        window.setTimeout(step, 0);
      };
      window.setTimeout(step, 0);
    },
  };
}
