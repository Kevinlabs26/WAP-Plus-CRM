import { rm } from "node:fs/promises";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  proto,
  useMultiFileAuthState,
} from "baileys";
import pino from "pino";
import QRCode from "qrcode";
import { json, requestBody } from "./httpUtil.mjs";
import {
  ensureOggOpusPtt,
  parseDataUrl,
} from "./audioConvert.mjs";
import { createMediaDownloader } from "./mediaDownload.mjs";
import { createRawMediaStore } from "./rawMediaStore.mjs";
import {
  createSelfJidChecker,
  isHumanName,
  isLidJid,
  looksLikeInternalId,
  phoneFromJid,
  prettyName,
} from "./jidUtils.mjs";
import { buildPresencePush } from "./presenceHandler.mjs";
import { startBaileysHttpServer } from "./httpServer.mjs";
import { createGroupService } from "./groupService.mjs";
import { createGroupWriteService } from "./groupWriteService.mjs";
import { attachGroupParticipantEvents } from "./groupEvents.mjs";
import { attachGroupJoinRequestEvents } from "./groupJoinRequestEvents.mjs";
import { attachMessageLifecycleEvents } from "./messageLifecycleEvents.mjs";
import { attachChatLifecycleEvents } from "./chatLifecycleEvents.mjs";
import { attachHistoryStatusEvents } from "./historyStatusEvents.mjs";
import {
  createBlocklistService,
  attachBlocklistEvents,
} from "./blocklistService.mjs";
import { normalizeGroupMetadata } from "./groupMeta.mjs";
import {
  createMessageIngest,
  extractChatLastMessages,
} from "./messageIngest.mjs";
import { createAvatarService } from "./avatarService.mjs";
import { createContactStore } from "./contactStore.mjs";
import { BoundedMessageMap } from "./messageStore.mjs";
import {
  BAILEYS_BRIDGE_PROTOCOL_VERSION,
  BAILEYS_LIBRARY_VERSION,
} from "./protocol.mjs";

const parentPid = Number(process.env.WAP_PARENT_PID || 0);
if (parentPid > 0) {
  const parentWatch = setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch {
      process.exit(0);
    }
  }, 2000);
  parentWatch.unref();
}

const port = Number(process.env.WAP_BAILEYS_PORT || 17891);
const token = process.env.WAP_BAILEYS_TOKEN || "";
const authDir = process.env.WAP_BAILEYS_AUTH_DIR || "./baileys-auth";
/** 多账号：与桌面端 accountId 对齐，事件 deviceId 带此值 */
const accountId = String(process.env.WAP_BAILEYS_ACCOUNT_ID || "baileys").trim() || "baileys";
// 排障：WAP_BAILEYS_LOG=info 或 WAP_SYNC_DEBUG=1 时打印同步链路
const syncDebugOn =
  process.env.WAP_SYNC_DEBUG === "1" ||
  process.env.WAP_BAILEYS_LOG === "info" ||
  process.env.WAP_BAILEYS_LOG === "debug";
const logger = pino({
  level: process.env.WAP_BAILEYS_LOG || (syncDebugOn ? "info" : "silent"),
});
const events = [];

/** 同步排障日志（stdout，tauri 会进 baileys-bridge-{account}.log） */
let lastSnapLogAt = 0;
function syncDbg(msg, data, opts = {}) {
  if (!syncDebugOn && !opts.force) return;
  // snapshot 太频：最多 5s 一条，避免刷盘拖慢
  if (msg === "snapshot" && !opts.force) {
    const now = Date.now();
    if (now - lastSnapLogAt < 5000) return;
    lastSnapLogAt = now;
  }
  const line = data !== undefined ? `${msg} ${safeJson(data)}` : msg;
  try {
    console.log(`[wap-sync][${accountId}] ${line}`);
  } catch {
    /* ignore */
  }
  try {
    logger.info(data || {}, `[wap-sync] ${msg}`);
  } catch {
    /* ignore */
  }
}
function safeJson(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
const contacts = new Map();
// ponytail: runtime cache only; SQLite owns full CRM history, so cap this map
// to prevent full-history sync from growing the sidecar indefinitely.
const messages = new BoundedMessageMap(20_000);
const labels = new Map();
const chatLabelIds = new Map();
const products = new Map();
/** message id → 原始 WA 消息（用于事后补下媒体） */
const rawWaByMsgId = new Map();
const rawMediaStore = createRawMediaStore(`${authDir}/media-index`);
/** 最近一次 presence 调试（/status 可见，确认协议有没有推） */
let lastPresenceDebug = null;
let presenceEventCount = 0;
let sequence = 0;
let eventsDroppedThrough = 0;
let socket;
/** Baileys may keep the account push name in auth creds instead of socket.user. */
let authMe;
let connection = "starting";
let qrDataUrl = "";
let lastError = "";
let reconnectTimer;
let connectGeneration = 0;
let connecting = false;
/** 连续非登出断线次数，用于退避；连上后清零 */
let reconnectAttempts = 0;
let lastDisconnectAt = 0;
let lastFullHistoryRequestAt = 0;
let connectPromise = null;

function createMemoryCache(ttlMs, maxEntries = 5000) {
  const values = new Map();
  const cache = {
    get(key) {
      const item = values.get(String(key));
      if (!item || item.expiresAt <= Date.now()) {
        values.delete(String(key));
        return undefined;
      }
      return item.value;
    },
    set(key, value) {
      const k = String(key);
      values.delete(k);
      values.set(k, { value, expiresAt: Date.now() + ttlMs });
      while (values.size > maxEntries) values.delete(values.keys().next().value);
      return cache;
    },
    delete(key) { return values.delete(String(key)); },
    clear() { values.clear(); },
    flushAll() { values.clear(); },
  };
  return cache;
}

const msgRetryCounterCache = createMemoryCache(10 * 60_000, 10_000);
const groupMetadataCache = new Map();
const groupMetadataTtlMs = 5 * 60_000;
const rawWaStore = createRawMediaStore(`${authDir}/message-index`, 20_000);

async function requestFullHistorySync() {
  if (connection !== "connected" || !socket) {
    throw new Error("WhatsApp 尚未连接");
  }
  const now = Date.now();
  const cooldownMs = Math.max(0, 120_000 - (now - lastFullHistoryRequestAt));
  if (cooldownMs > 0) return { requested: false, cooldownMs };
  const requestId = `wap-${accountId}-${now}`;
  const peerMessageId = await socket.sendPeerDataOperationMessage({
    peerDataOperationRequestType:
      proto.Message.PeerDataOperationRequestType.FULL_HISTORY_SYNC_ON_DEMAND,
    fullHistorySyncOnDemandRequest: {
      requestMetadata: { requestId },
      historySyncConfig: {
        storageQuotaMb: 10240,
        inlineInitialPayloadInE2EeMsg: true,
        onDemandReady: true,
        completeOnDemandReady: true,
      },
    },
  });
  lastFullHistoryRequestAt = now;
  push("history.sync_status", {
    status: "requested",
    explicit: true,
    requestId,
    source: "manual.full-history",
  });
  return { requested: true, requestId, peerMessageId };
}

function push(type, payload) {
  const body =
    payload && typeof payload === "object" ? { ...payload } : { value: payload };
  if (!body.accountId) body.accountId = accountId;
  events.push({
    seq: ++sequence,
    protocolVersion: BAILEYS_BRIDGE_PROTOCOL_VERSION,
    type,
    ts: Date.now(),
    deviceId: accountId,
    accountId,
    payload: body,
  });
  if (events.length > 2000) {
    const removed = events.splice(0, events.length - 2000);
    eventsDroppedThrough = removed[removed.length - 1]?.seq || eventsDroppedThrough;
  }
  if (
    type === "contacts.sync" ||
    type === "messages.sync" ||
    type === "device.hello"
  ) {
    const n = Array.isArray(body.items) ? body.items.length : undefined;
    syncDbg(`push ${type}`, {
      source: body.source,
      items: n,
      live: body.live,
      memContacts: contacts.size,
      memMessages: messages.size,
    });
  }
}

function timestamp(value) {
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  if (typeof value === "bigint") return Number(value) * 1000;
  if (value?.toNumber) return value.toNumber() * 1000;
  return Date.now();
}

const { mediaToDataUrl } = createMediaDownloader({
  logger,
  getConnection: () => connection,
  getSocket: () => socket,
});

function rememberRawWa(id, waMessage) {
  if (!id || !waMessage) return;
  // 刷新插入顺序，近似 LRU（Map 保持插入序）
  if (rawWaByMsgId.has(id)) rawWaByMsgId.delete(id);
  rawWaByMsgId.set(id, waMessage);
  void rawWaStore.save(id, waMessage);
  while (rawWaByMsgId.size > 2000) {
    const oldest = rawWaByMsgId.keys().next().value;
    if (oldest == null) break;
    rawWaByMsgId.delete(oldest);
  }
}

function rememberRawMedia(id, waMessage) {
  if (id && waMessage) void rawMediaStore.save(id, waMessage);
}

function rawWaKey(key) {
  const id = String(key?.id || "").trim();
  if (!id) return "";
  return key?.remoteJid ? `${key.remoteJid}:${id}` : id;
}

async function getRawWaByKey(key) {
  const direct = rawWaByMsgId.get(rawWaKey(key)) || rawWaByMsgId.get(key?.id);
  if (direct) return direct;
  const stored =
    (await rawWaStore.load(rawWaKey(key))) ||
    (await rawWaStore.load(key?.id));
  if (stored) rememberRawWa(rawWaKey(key) || key?.id, stored);
  return stored;
}

function findStoredMessageByKey(key) {
  if (!key?.id) return null;
  const direct = messages.get(key.id);
  if (direct) return direct;
  for (const item of messages.values()) {
    if (item?.waKey?.id === key.id) return item;
    if (item?.id === key.id) return item;
  }
  return null;
}

/** 是否登录号本人（避免把自己扫成联系人「E」） */
function selfJidCandidates() {
  const u = socket?.user;
  if (!u) return [];
  const out = [];
  for (const k of [u.id, u.lid, u.phoneNumber, u.jid]) {
    if (typeof k === "string" && k.trim()) out.push(k.trim());
  }
  // id 可能带设备后缀 123:xx@s.whatsapp.net
  for (const j of [...out]) {
    if (j.includes(":")) {
      const bare = j.replace(/:\d+@/, "@");
      if (bare !== j) out.push(bare);
    }
    const p = phoneFromJid(j);
    if (p) out.push(`${p.replace(/\D/g, "")}@s.whatsapp.net`);
  }
  return out;
}

const isSelfJid = createSelfJidChecker(() => selfJidCandidates());


const {
  mergeHumanName,
  rememberLidPn,
  upsertContact,
  resolvePnJid,
  enrichContact,
} = createContactStore({
  contacts,
  getSocket: () => socket,
  isSelfJid,
});

const {
  lookupStoredName,
  contactPayload,
  ingestMessage,
} = createMessageIngest({
  contacts,
  messages,
  isSelfJid,
  upsertContact,
  mergeHumanName,
  rememberLidPn,
  rememberRawWa,
  rememberRawMedia,
  mediaToDataUrl,
  getOrderDetails: (orderId, token) => socket?.getOrderDetails(orderId, token),
  enrichContact,
  enqueueAvatar: (...args) => enqueueAvatar(...args),
  push,
  timestamp,
});

function recoverChatLastMessages(chats, source) {
  const recovered = [];
  for (const raw of extractChatLastMessages(chats)) {
    const id = raw.key.id;
    const item = messages.get(id) || ingestMessage(raw);
    if (item) recovered.push(item);
  }
  if (recovered.length) {
    syncDbg("recover chat last messages", {
      source,
      chats: chats?.length || 0,
      recovered: recovered.length,
    });
  }
  return recovered;
}

const {
  findContactByAnyJid,
  fetchAvatarDataUrl,
  enqueueAvatar,
  fetchAvatarHd,
  fetchAvatarForJids,
  scheduleAvatarsForActive,
} = createAvatarService({
  contacts,
  getConnection: () => connection,
  getSocket: () => socket,
  logger,
  push,
  enrichContact,
  contactPayload,
});

/** 当前 socket 会话内写入群元数据；connect 时刷新 */
let liveUpsertWaGroup = null;
let liveScheduleContactsPush = null;

const groupService = createGroupService({
  getSocket: () => socket,
  getConnection: () => connection,
  contacts,
  upsertContact,
  scheduleContactsPush: () => {
    if (typeof liveScheduleContactsPush === "function") liveScheduleContactsPush();
  },
  fetchAvatarDataUrl,
  syncDbg,
});

const groupWriteService = createGroupWriteService({
  getSocket: () => socket,
  getConnection: () => connection,
  groupService,
  resolveSendJid: (addr) => {
    // resolveSendJid 在文件后部定义，运行时已初始化
    return resolveSendJid(addr);
  },
  syncDbg,
});

const blocklistService = createBlocklistService({
  getSocket: () => socket,
  getConnection: () => connection,
  push,
  syncDbg,
});


/**
 * 拉取参与中的群 subject（群名）。
 * force=true 时不跳过已有人名（手动同步用）；否则只补缺名。
 */
async function hydrateGroupSubjects(opts = {}) {
  const force = Boolean(opts.force);
  const limit = Math.max(1, Number(opts.limit) || 200);
  const sock = socket;
  if (!sock || connection !== "connected") {
    syncDbg("hydrateGroupSubjects skip", { reason: "not_connected", force });
    return { checked: 0, updated: 0 };
  }
  const upsert =
    typeof liveUpsertWaGroup === "function" ? liveUpsertWaGroup : null;
  if (!upsert) {
    syncDbg("hydrateGroupSubjects skip", { reason: "no_upsert", force });
    return { checked: 0, updated: 0 };
  }
  try {
    let n = 0;
    let checked = 0;
    // 一次拉全部参与群（含 subject），比逐个 groupMetadata 快
    if (typeof sock.groupFetchAllParticipating === "function") {
      try {
        const all = await sock.groupFetchAllParticipating();
        const list = all && typeof all === "object" ? Object.values(all) : [];
        checked = list.length;
        for (const group of list) {
          if (upsert(group)) n++;
        }
        syncDbg("hydrateGroupSubjects fetchAll", {
          force,
          groups: list.length,
          updated: n,
        });
      } catch (e) {
        syncDbg("hydrateGroupSubjects fetchAll error", { err: String(e) });
      }
    }
    // 仍缺真名的 @g.us 再逐个补（退群/权限失败忽略）
    // force 时若 fetchAll 已写入 subject，则不再对全部群打 groupMetadata
    const ids = [...contacts.keys()].filter((j) => String(j).endsWith("@g.us"));
    let per = 0;
    for (const id of ids.slice(0, limit)) {
      const cur = contacts.get(id);
      if (cur?.displayName && isHumanName(cur.displayName)) continue;
      try {
        const meta = await sock.groupMetadata(id);
        if (upsert(meta)) {
          n++;
          per++;
        }
      } catch {
        /* 无权限/退群 */
      }
      await new Promise((r) => setTimeout(r, force ? 80 : 120));
    }
    checked = Math.max(checked, ids.length);
    if (n && typeof liveScheduleContactsPush === "function") {
      liveScheduleContactsPush();
    } else if (n) {
      const data = snapshot();
      if (data.contacts.length) {
        push("contacts.sync", {
          items: data.contacts,
          source: force ? "groups.manual" : "groups.hydrate",
        });
      }
    }
    syncDbg("hydrateGroupSubjects", {
      force,
      checked,
      updated: n,
      perMeta: per,
    });
    return { checked, updated: n };
  } catch (e) {
    syncDbg("hydrateGroupSubjects error", { err: String(e) });
    return { checked: 0, updated: 0, error: String(e) };
  }
}

function snapshot() {
  // 按 LID（优先）/ 号码 去重，始终带 channelAddress=LID 方便前端对齐会话
  // 顺带丢掉本人
  const before = contacts.size;
  for (const [k, c] of [...contacts.entries()]) {
    if (isSelfJid(k) || isSelfJid(c?.jid) || isSelfJid(c?.pnJid) || isSelfJid(c?.lidJid)) {
      contacts.delete(k);
    }
  }
  const byKey = new Map();
  let skippedSelf = 0;
  let skippedPayload = 0;
  for (const c of contacts.values()) {
    if (isSelfJid(c.jid) || isSelfJid(c.lidJid) || isSelfJid(c.pnJid)) {
      skippedSelf++;
      continue;
    }
    const key = c.lidJid || c.phoneE164 || c.pnJid || c.jid;
    const row = contactPayload(c);
    if (!row) {
      skippedPayload++;
      continue;
    }
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, row);
      continue;
    }
    const prevHuman = isHumanName(prev.displayName);
    const nextHuman = isHumanName(row.displayName);
    byKey.set(key, {
      ...prev,
      ...row,
      displayName: nextHuman
        ? row.displayName
        : prevHuman
          ? prev.displayName
          : row.displayName || prev.displayName,
      phoneE164: row.phoneE164 || prev.phoneE164,
      channelAddress: prev.channelAddress?.includes("@lid")
        ? prev.channelAddress
        : row.channelAddress || prev.channelAddress,
      avatarUrl: row.avatarUrl || prev.avatarUrl,
      lastMessage: row.lastMessage || prev.lastMessage,
      updatedAt: Math.max(row.updatedAt || 0, prev.updatedAt || 0),
    });
  }
  const outContacts = [...byKey.values()];
  const withLm = outContacts.filter(
    (c) => c.lastMessage && String(c.lastMessage).trim()
  ).length;
  syncDbg("snapshot", {
    mapBefore: before,
    mapAfter: contacts.size,
    deduped: outContacts.length,
    withLastMessage: withLm,
    messages: messages.size,
    skippedSelf,
    skippedPayload,
    sample: outContacts.slice(0, 3).map((c) => ({
      name: c.displayName,
      phone: c.phoneE164,
      jid: c.jid,
      lm: c.lastMessage ? String(c.lastMessage).slice(0, 30) : "",
    })),
  });
  return {
    // 不要在同步快照里截断联系人。联系人/消息的完整性比单次响应大小更
    // 重要；前端会按批处理并分页，截断会让首次同步后永远缺少旧联系人。
    contacts: outContacts.sort(
      (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
    ),
    // 事件缓冲溢出后会依赖 /sync 补齐，不能只返回最近 2000 条，否则
    // 历史消息会永久丢失。前端 ingest 会分片让出主线程。
    messages: [...messages.values()].sort((a, b) => a.sentAt - b.sentAt),
  };
}

async function endSocketQuietly() {
  const current = socket;
  socket = undefined;
  authMe = undefined;
  if (!current) return;
  try {
    current.ev?.removeAllListeners?.();
  } catch {
    /* ignore */
  }
  try {
    current.ws?.close?.();
  } catch {
    /* ignore */
  }
  try {
    await current.end?.(undefined);
  } catch {
    /* ignore */
  }
}

async function getCachedGroupMetadata(jid) {
  const id = String(jid || "").trim();
  if (!id.endsWith("@g.us")) return undefined;
  const cached = groupMetadataCache.get(id);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  try {
    const meta = await socket?.groupMetadata?.(id);
    if (meta) groupMetadataCache.set(id, {
      value: meta,
      expiresAt: Date.now() + groupMetadataTtlMs,
    });
    return meta;
  } catch {
    return undefined;
  }
}

function cacheGroupMetadata(meta) {
  if (meta?.id && Array.isArray(meta.participants)) {
    groupMetadataCache.set(meta.id, {
      value: meta,
      expiresAt: Date.now() + groupMetadataTtlMs,
    });
  }
}

function isIgnoredJid(jid) {
  const value = String(jid || "").toLowerCase();
  return value === "status@broadcast" ||
    value.endsWith("@broadcast") ||
    value.endsWith("@newsletter");
}

/**
 * @param {{ clearAuth?: boolean }} [opts]
 */
async function connect(opts = {}) {
  if (connectPromise) {
    if (!opts.clearAuth) return connectPromise;
    await connectPromise.catch(() => {});
  }
  const next = connectInternal(opts);
  connectPromise = next.finally(() => {
    if (connectPromise === wrapped) connectPromise = null;
  });
  const wrapped = connectPromise;
  return wrapped;
}

async function connectInternal(opts = {}) {
  const myGen = ++connectGeneration;
  if (connecting) {
    // 等上一轮结束
    await new Promise((r) => setTimeout(r, 300));
  }
  connecting = true;
  clearTimeout(reconnectTimer);

  try {
    if (opts.clearAuth) {
      await endSocketQuietly();
      await rm(authDir, { recursive: true, force: true });
      qrDataUrl = "";
      lastError = "";
      connection = "starting";
    } else {
      await endSocketQuietly();
      connection = connection === "connected" ? "reconnecting" : "starting";
      qrDataUrl = "";
    }

    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    if (myGen !== connectGeneration) return;
    authMe = state.creds.me || undefined;

    const sock = makeWASocket({
      auth: state,
      logger,
      // Desktop 指纹配合完整历史同步；官方推荐用于更完整的历史。
      browser: Browsers.macOS("Desktop"),
      syncFullHistory: true,
      shouldSyncHistoryMessage: () => true,
      // 后台 CRM 默认不占用在线态，避免抑制手机端推送。
      markOnlineOnConnect: false,
      msgRetryCounterCache,
      cachedGroupMetadata: getCachedGroupMetadata,
      shouldIgnoreJid: isIgnoredJid,
      getMessage: async (key) => {
        const raw = await getRawWaByKey(key);
        return raw?.message || raw || undefined;
      },
    });
    socket = sock;

    sock.ev.on("creds.update", (update) => {
      if (update?.me) {
        authMe = { ...(authMe || {}), ...update.me };
      }
      void saveCreds(update);
    });

    let contactsPushTimer;
    const scheduleContactsPush = () => {
      clearTimeout(contactsPushTimer);
      contactsPushTimer = setTimeout(() => {
        const data = snapshot();
        if (data.contacts.length) {
          push("contacts.sync", { items: data.contacts, source: "contacts" });
        }
      }, 400);
    };

    const contactNameOf = (item) => {
      // WhatsApp 有时把电话号码放在 name/displayName，把真实默认昵称放在
      // notify/pushName；不能只取第一个非空字段。
      const candidates = [
        item?.name,
        item?.displayName,
        item?.subject,
        item?.notify,
        item?.verifiedName,
        item?.pushName,
        item?.username,
      ];
      return (
        candidates.find((value) => isHumanName(value)) ||
        candidates.find((value) => typeof value === "string" && value.trim()) ||
        ""
      );
    };

    /**
     * v7 Contact：id 为 WhatsApp 首选（LID 或 PN）；
     * id 为 LID 时 phoneNumber 常为 PN；id 为 PN 时 lid 为 LID。
     * 文档：协议不能 LID→完整手机号，只能靠映射 / phoneNumber / remoteJidAlt。
     */
    const upsertWaContact = (item) => {
      if (!item?.id) return null;
      const id = item.id;
      const phoneHint =
        item.phoneNumber ||
        (String(id).endsWith("@s.whatsapp.net") || String(id).endsWith("@c.us")
          ? id
          : "");
      if (isLidJid(id) && item.phoneNumber) {
        rememberLidPn(id, item.phoneNumber);
      } else if (item.lid && item.phoneNumber) {
        rememberLidPn(item.lid, item.phoneNumber);
      } else if (item.lid && !isLidJid(id)) {
        rememberLidPn(item.lid, id);
      }
      return upsertContact(id, contactNameOf(item), phoneHint);
    };

    const upsertWaGroup = (group) => {
      const id = group?.id || group?.jid;
      if (!String(id || "").endsWith("@g.us")) return null;
      // 有完整 metadata 时写摘要字段；否则只补名
      const norm = normalizeGroupMetadata(group);
      if (norm) {
        return groupService.applyGroupSummary(norm) || null;
      }
      const c = upsertContact(
        id,
        group.subject || group.name || group.displayName || ""
      );
      if (!c) return null;
      c.isGroup = true;
      if (Array.isArray(group.participants)) {
        c.participantCount = group.participants.length;
      }
      if (group.owner) c.groupOwner = group.owner;
      contacts.set(id, c);
      return c;
    };

    // 供模块级 hydrateGroupSubjects / 手动 /sync 调用
    liveUpsertWaGroup = upsertWaGroup;
    liveScheduleContactsPush = scheduleContactsPush;

    sock.ev.on("contacts.upsert", (items) => {
      let n = 0;
      for (const item of items) {
        if (upsertWaContact(item)) n++;
      }
      if (n) scheduleContactsPush();
    });
    sock.ev.on("contacts.update", (items) => {
      let n = 0;
      for (const item of items || []) {
        if (upsertWaContact(item)) n++;
      }
      if (n) scheduleContactsPush();
    });
    sock.ev.on("groups.upsert", (items) => {
      let n = 0;
      for (const group of items || []) {
        cacheGroupMetadata(group);
        if (upsertWaGroup(group)) n++;
      }
      if (n) scheduleContactsPush();
    });
    sock.ev.on("groups.update", (items) => {
      let n = 0;
      for (const group of items || []) {
        cacheGroupMetadata(group);
        if (upsertWaGroup(group)) n++;
      }
      if (n) scheduleContactsPush();
    });
    sock.ev.on("group-participants.update", ({ id }) => {
      if (!id) return;
      void sock.groupMetadata(id).then(cacheGroupMetadata).catch(() => {});
    });
    attachGroupParticipantEvents(sock, {
      getSocket: () => sock,
      contacts,
      messages,
      upsertContact,
      applyGroupSummary: (norm) => groupService.applyGroupSummary(norm),
      scheduleContactsPush,
      push,
      lookupName: (jid) => {
        const c = contacts.get(jid);
        return c?.displayName || "";
      },
    });

    attachGroupJoinRequestEvents(sock, {
      contacts,
      messages,
      upsertContact,
      applyGroupSummary: (norm) => groupService.applyGroupSummary(norm),
      scheduleContactsPush,
      push,
      lookupName: (jid) => {
        const c = contacts.get(jid);
        return c?.displayName || "";
      },
    });

    // 消息生命周期：对端撤回（messages.delete）与独立 reaction 推送
    attachMessageLifecycleEvents(sock, {
      push,
      messages,
    });

    // 会话删除同步：手机端删除会话 → 桌面侧栏移除
    attachChatLifecycleEvents(sock, {
      push,
      contacts,
    });

    // 历史同步阶段状态推送（桌面端「历史同步完成/暂停」提示）
    attachHistoryStatusEvents(sock, { push });

    // 远端黑名单变更（blocklist.set / blocklist.update）
    attachBlocklistEvents(sock, blocklistService);
    sock.ev.on("labels.edit", (label) => {
      if (!label?.id) return;
      if (label.deleted) {
        labels.delete(label.id);
        for (const ids of chatLabelIds.values()) ids.delete(label.id);
      } else {
        labels.set(label.id, {
          id: label.id,
          name: String(label.name || "").trim(),
          color: Number(label.color) || 0,
          predefinedId: label.predefinedId,
        });
      }
    });
    sock.ev.on("labels.association", ({ association, type }) => {
      if (association?.type !== "label_jid") return;
      const jid = association.chatId;
      const labelId = association.labelId;
      if (!jid || !labelId) return;
      const ids = chatLabelIds.get(jid) || new Set();
      if (type === "remove") ids.delete(labelId);
      else ids.add(labelId);
      if (ids.size) chatLabelIds.set(jid, ids);
      else chatLabelIds.delete(jid);
    });
    const pushContactUpdate = (c, source = "enrich") => {
      if (!c) return;
      const payload = contactPayload(c);
      if (!payload) return;
      push("contacts.sync", { items: [payload], source });
    };

    const applyChatRecord = (chat) => {
      if (!chat) return null;
      const chatId = chat.id || chat.jid;
      if (!chatId) return null;
      const pn = chat.pnJid || chat.phoneNumber || chat.pn || "";
      const lid = chat.lidJid || chat.accountLid || "";
      const name = contactNameOf(chat);
      if (isLidJid(chatId) && pn) rememberLidPn(chatId, pn);
      else if (lid && (pn || String(chatId).endsWith("@s.whatsapp.net"))) {
        rememberLidPn(lid, pn || chatId);
      }
      const c = upsertContact(
        chatId,
        name,
        pn || phoneFromJid(chatId) || ""
      );
      if (!c) return null;
      // 会话列表预览：没有正文也要有时间戳，前端才能建会话行
      const convTs =
        Number(chat.conversationTimestamp) ||
        Number(chat.conversationTimestampMs) ||
        Number(chat.lastMsgTimestamp) ||
        0;
      const preview =
        (typeof chat.lastMessage === "string" && chat.lastMessage) ||
        chat.lastMsg?.message?.conversation ||
        chat.lastMsg?.message?.extendedTextMessage?.text ||
        "";
      // 仅有真实预览正文才写 lastMessage（勿用空格占位，否则会话列表=全通讯录）
      if (preview && String(preview).trim()) {
        c.lastMessage = String(preview).trim().slice(0, 500);
      }
      if (convTs) {
        const ms = convTs < 1e12 ? convTs * 1000 : convTs;
        c.updatedAt = Math.max(c.updatedAt || 0, ms);
      }
      contacts.set(c.jid || chatId, c);
      if (pn) {
        const pnJid = String(pn).includes("@")
          ? pn
          : `${String(pn).replace(/\D/g, "")}@s.whatsapp.net`;
        const c2 = upsertContact(pnJid, name, pn);
        if (c2) {
          if (!c2.lastMessage) c2.lastMessage = c.lastMessage;
          c2.updatedAt = Math.max(c2.updatedAt || 0, c.updatedAt || 0);
        }
      }
      return c;
    };

    // Baileys 同步到的 LID↔手机号映射
    sock.ev.on("lid-mapping.update", ({ lid, pn }) => {
      if (lid && pn) {
        rememberLidPn(lid, pn);
        void enrichContact(lid, "", pn).then((c) =>
          pushContactUpdate(c, "lid-map")
        );
      }
    });

    sock.ev.on("chats.upsert", (items) => {
      let n = 0;
      for (const chat of items || []) {
        if (applyChatRecord(chat)) n++;
      }
      const recovered = recoverChatLastMessages(items, "chats.upsert");
      if (n) {
        const data = snapshot();
        push("contacts.sync", {
          items: data.contacts.slice(0, 200),
          source: "chats",
        });
      }
      if (recovered.length) {
        push("messages.sync", {
          items: recovered,
          live: false,
          source: "chats.upsert",
        });
      }
    });
    sock.ev.on("chats.update", (items) => {
      for (const chat of items || []) applyChatRecord(chat);
      const recovered = recoverChatLastMessages(items, "chats.update");
      if (recovered.length) {
        push("messages.sync", {
          items: recovered,
          live: true,
          source: "chats.update",
        });
      }
    });

    sock.ev.on("messaging-history.set", (data) => {
      const {
        chats = [],
        contacts: people = [],
        messages: history = [],
        lidPnMappings = [],
      } = data || {};
      syncDbg("messaging-history.set", {
        chats: chats.length,
        people: people.length,
        history: history.length,
        lidMaps: (lidPnMappings || []).length,
        memContactsBefore: contacts.size,
        memMessagesBefore: messages.size,
      });

      // 0) 历史同步自带的 PN↔LID（v7 关键，Baileys 内部也会 store，这里再灌进我们的 contacts）
      for (const m of lidPnMappings || []) {
        if (m?.lid && m?.pn) rememberLidPn(m.lid, m.pn);
      }

      // 1) 通讯录（v7：id + phoneNumber / lid）
      for (const item of people) upsertWaContact(item);

      // 2) 会话：chat.pnJid / lidJid
      for (const chat of chats) applyChatRecord(chat);

      // 3) 消息：只收集本批 history 产出，禁止再 snapshot 全库 messages 一次砸前端
      const HISTORY_MSG_CHUNK = 80;
      const HISTORY_CONTACT_CHUNK = 120;
      const batchItems = [];
      for (const message of history) {
        const item = ingestMessage(message);
        if (item) {
          // 事件路径绝不带 base64 正文媒体（thumb 除外，通常很小）
          if (
            item.mediaUrl &&
            typeof item.mediaUrl === "string" &&
            item.mediaUrl.startsWith("data:") &&
            item.mediaUrl.length > 8_000
          ) {
            item.mediaUrl = "";
            item.mediaPending = true;
          }
          batchItems.push(item);
        }
      }

      // 4) 再扫一遍通讯录（含 PUSH_NAME 同步的 notify），把名字盖回会话
      for (const item of people) upsertWaContact(item);
      // 仅回填本批消息名，避免扫全 Map
      for (const msg of batchItems) {
        if (isHumanName(msg.displayName)) continue;
        const n = lookupStoredName(msg.jid, msg.channelAddress);
        if (n) {
          msg.displayName = n;
          messages.set(msg.id, msg);
          const c = contacts.get(msg.jid) || contacts.get(msg.channelAddress);
          if (c) mergeHumanName(c, n);
        }
      }

      const histSnap = snapshot();
      const contactRows = histSnap.contacts || [];
      const contactTotal = Math.max(
        1,
        Math.ceil(contactRows.length / HISTORY_CONTACT_CHUNK)
      );
      for (let i = 0; i < contactRows.length; i += HISTORY_CONTACT_CHUNK) {
        const slice = contactRows.slice(i, i + HISTORY_CONTACT_CHUNK);
        push("contacts.sync", {
          items: slice,
          source: "history",
          historyChunk: {
            index: Math.floor(i / HISTORY_CONTACT_CHUNK),
            total: contactTotal,
          },
        });
      }

      const msgTotal = Math.max(
        1,
        Math.ceil(batchItems.length / HISTORY_MSG_CHUNK) || 1
      );
      if (!batchItems.length) {
        // 仍发空批，方便前端知道 history 事件到了
        push("messages.sync", {
          items: [],
          source: "history",
          live: false,
          historyChunk: { index: 0, total: 1 },
        });
      } else {
        for (let i = 0; i < batchItems.length; i += HISTORY_MSG_CHUNK) {
          const slice = batchItems.slice(i, i + HISTORY_MSG_CHUNK);
          push("messages.sync", {
            items: slice,
            source: "history",
            live: false,
            historyChunk: {
              index: Math.floor(i / HISTORY_MSG_CHUNK),
              total: msgTotal,
            },
          });
        }
      }

      // 历史灌完后：轻量 enrich + 头像（联系人分片推，避免二次全量）
      setTimeout(() => {
        void (async () => {
          const recent = [...contacts.values()]
            .filter((c) => c.lastMessage || c.updatedAt)
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
            .slice(0, 80);
          for (const c of recent) {
            await enrichContact(
              c.jid,
              c.displayName,
              c.pnJid || c.phoneE164 || ""
            );
          }
          scheduleAvatarsForActive(24);
          const snap = snapshot();
          const rows = (snap.contacts || []).slice(0, 200);
          if (rows.length) {
            for (let i = 0; i < rows.length; i += HISTORY_CONTACT_CHUNK) {
              push("contacts.sync", {
                items: rows.slice(i, i + HISTORY_CONTACT_CHUNK),
                source: "enrich",
              });
            }
          }
        })();
      }, 800);
    });
    sock.ev.on("messages.upsert", ({ messages: incoming, type }) => {
      const items = (incoming || []).map(ingestMessage).filter(Boolean);
      if (!items.length) return;
      const live = type === "notify" || type === "append" || !type;
      // 先推联系人（含 pushName/channelAddress），再推消息，列表立刻能对上名
      const contactItems = [];
      const seen = new Set();
      for (const m of items) {
        // 反应项无 jid 业务联系人时仍要推
        if (m.kind === "reaction") continue;
        const c =
          contacts.get(m.jid) ||
          contacts.get(m.channelAddress) ||
          (m.phoneE164 &&
            [...contacts.values()].find((x) => x.phoneE164 === m.phoneE164));
        if (!c) continue;
        const key = c.lidJid || c.phoneE164 || c.jid;
        if (seen.has(key)) continue;
        seen.add(key);
        const p = contactPayload(c);
        if (p) contactItems.push(p);
      }
      if (contactItems.length) {
        push("contacts.sync", { items: contactItems, source: "message" });
      }
      // 实时路径同样不推大体量 base64（按需 /message/media）
      const lightItems = items.map((it) => {
        if (
          it?.mediaUrl &&
          typeof it.mediaUrl === "string" &&
          it.mediaUrl.startsWith("data:") &&
          it.mediaUrl.length > 8_000
        ) {
          return { ...it, mediaUrl: "", mediaPending: true };
        }
        return it;
      });
      push("messages.sync", {
        items: lightItems,
        live,
        source: type || "upsert",
      });
    });

    // 送达 / 已读：status 2=SERVER 3=DELIVERY 4=READ 5=PLAYED
    sock.ev.on("messages.update", (updates) => {
      if (!Array.isArray(updates) || !updates.length) return;
      const items = [];
      for (const u of updates) {
        const key = u?.key;
        const st = u?.update?.status;
        if (!key?.id || st == null) continue;
        let ack = "sent";
        if (st >= 5) ack = "played";
        else if (st >= 4) ack = "read";
        else if (st >= 3) ack = "delivered";
        else if (st >= 2) ack = "server";
        items.push({
          id: key.id,
          remoteJid: key.remoteJid,
          fromMe: Boolean(key.fromMe),
          status: st,
          ack,
        });
      }
      if (items.length) {
        push("messages.ack", { items, source: "messages.update" });
      }
    });

    sock.ev.on("message-receipt.update", (updates) => {
      if (!Array.isArray(updates) || !updates.length) return;
      const items = [];
      for (const u of updates) {
        const key = u?.key;
        const receipt = u?.receipt;
        if (!key?.id) continue;
        // receipt 可能含 receiptTimestamp / readTimestamp
        let ack = "delivered";
        if (receipt?.playedTimestamp) ack = "played";
        else if (receipt?.readTimestamp) ack = "read";
        else if (receipt?.receiptTimestamp) ack = "delivered";
        items.push({
          id: key.id,
          remoteJid: key.remoteJid,
          fromMe: Boolean(key.fromMe),
          ack,
        });
      }
      if (items.length) {
        push("messages.ack", { items, source: "receipt" });
      }
    });

    // 对方正在输入 / 录音 / 在线（订阅后才会持续推）
    sock.ev.on("presence.update", (update) => {
      try {
        const built = buildPresencePush(update, { findContactByAnyJid });
        if (!built) return;
        presenceEventCount += 1;
        lastPresenceDebug = {
          at: Date.now(),
          chatJid: built.chatJid,
          rawKeys: built.rawKeys,
          items: built.items.map((it) => ({
            presence: it.presence,
            jid: it.jid,
            phoneE164: it.phoneE164,
            aliases: it.aliases,
          })),
        };
        if (built.items.length) {
          push("presence.update", { items: built.items, source: "baileys" });
        }
      } catch (e) {
        logger?.debug?.({ err: String(e) }, "presence.update handler");
      }
    });

    sock.ev.on("connection.update", async (update) => {
      if (myGen !== connectGeneration) return;
      // 已登录时偶发 qr 刷新：不要把状态打成 qr（否则前端变「点此扫码」）
      if (update.qr) {
        const hadSession = Boolean(sock.authState?.creds?.me || sock.user);
        if (!hadSession) {
          connection = "qr";
          lastError = "";
          try {
            qrDataUrl = await QRCode.toDataURL(update.qr, {
              margin: 1,
              width: 280,
            });
          } catch (e) {
            lastError = `二维码生成失败：${e}`;
          }
        }
      }
      if (update.connection === "open") {
        connection = "connected";
        qrDataUrl = "";
        lastError = "";
        reconnectAttempts = 0;
        syncDbg("connection open", {
          user: sock.user?.id || sock.user?.name || null,
          authName: authMe?.name || null,
          memContacts: contacts.size,
          memMessages: messages.size,
        });
        // 连接后立刻清掉误入库的本人联系人
        for (const [k, c] of [...contacts.entries()]) {
          if (isSelfJid(k) || isSelfJid(c?.jid) || isSelfJid(c?.pnJid)) {
            contacts.delete(k);
          }
        }
        push("device.hello", {
          id: "baileys",
          name: authMe?.name || sock.user?.name || "WhatsApp",
          model: "Baileys",
          battery: 100,
        });
        // 连上后给最近会话慢慢补头像
        setTimeout(() => scheduleAvatarsForActive(24), 2500);
        setTimeout(() => void hydrateGroupSubjects(), 2_500);
      }
      if (update.connection === "close") {
        const statusCode = update.lastDisconnect?.error?.output?.statusCode;
        const errMsg =
          update.lastDisconnect?.error?.message ||
          String(update.lastDisconnect?.error || "Connection Terminated");
        lastError = errMsg;
        lastDisconnectAt = Date.now();
        const loggedOut =
          statusCode === DisconnectReason.loggedOut || statusCode === 401;
        // badSession 才清；403 有时是临时限制，勿动辄清 auth
        const shouldClear =
          loggedOut || statusCode === DisconnectReason.badSession;

        if (shouldClear) {
          connection = "logged_out";
          qrDataUrl = "";
        } else {
          connection = "reconnecting";
          // 重连中不要亮旧码
          qrDataUrl = "";
        }

        if (myGen !== connectGeneration) return;
        clearTimeout(reconnectTimer);

        // 指数退避：1.5s → 3s → … 封顶 45s，减轻 WhatsApp 侧踢线
        reconnectAttempts = shouldClear ? 0 : reconnectAttempts + 1;
        const delay = shouldClear
          ? 800
          : Math.min(
              45_000,
              Math.round(1500 * Math.pow(1.7, Math.min(reconnectAttempts, 8)))
            );

        reconnectTimer = setTimeout(() => {
          void connect({ clearAuth: shouldClear }).catch((error) => {
            connection = "error";
            lastError = String(error);
            push("baileys.error", { message: String(error) });
            // 失败后再试一次（不清除 auth）
            if (!shouldClear) {
              clearTimeout(reconnectTimer);
              reconnectTimer = setTimeout(() => {
                void connect({ clearAuth: false }).catch(() => {});
              }, 8000);
            }
          });
        }, delay);
      }
    });
  } catch (error) {
    if (myGen === connectGeneration) {
      connection = "error";
      lastError = error instanceof Error ? error.message : String(error);
      push("baileys.error", { message: lastError });
    }
    throw error;
  } finally {
    if (myGen === connectGeneration) connecting = false;
  }
}


function resolveSendJid(address) {
  const addr = String(address || "").trim();
  if (!addr) return Promise.resolve("");
  if (addr.endsWith("@g.us")) return Promise.resolve(addr);
  if (
    addr.includes("@lid") ||
    (!addr.includes("@") &&
      /^\d{14,}$/.test(addr.replace(/\D/g, "")) &&
      addr.replace(/\D/g, "").length >= 14)
  ) {
    const lid = addr.includes("@lid")
      ? addr
      : `${addr.replace(/\D/g, "")}@lid`;
    return (async () => {
      const known = findContactByAnyJid(lid) || findContactByAnyJid(addr);
      if (known?.pnJid) return known.pnJid;
      if (known?.phoneE164) {
        const d = known.phoneE164.replace(/\D/g, "");
        if (d) return `${d}@s.whatsapp.net`;
      }
      const pn = await resolvePnJid(lid);
      return pn || lid;
    })();
  }
  if (addr.includes("@s.whatsapp.net") || addr.includes("@c.us")) {
    return Promise.resolve(addr.replace(/@c\.us$/, "@s.whatsapp.net"));
  }
  const digits = addr.replace(/\D/g, "");
  if (!digits || digits.length < 7) return Promise.resolve("");
  return Promise.resolve(`${digits}@s.whatsapp.net`);
}

async function requestPairingCode(phoneNumber) {
  const raw = String(phoneNumber || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (!/^\d{7,15}$/.test(digits) || /[^\d+\s().-]/.test(raw)) {
    throw new Error("手机号必须包含国家码，且只允许数字、空格、+、括号或短横线");
  }
  if (!socket || !["starting", "qr", "reconnecting"].includes(connection)) {
    throw new Error("请先启动未登录的 WhatsApp 会话");
  }
  if (socket.authState?.creds?.registered || socket.user) {
    throw new Error("当前会话已经登录");
  }
  return { phoneNumber: digits, code: await socket.requestPairingCode(digits) };
}

async function checkWhatsAppNumbers(numbers) {
  if (!socket || connection !== "connected") throw new Error("WhatsApp 尚未连接");
  const input = [...new Set((Array.isArray(numbers) ? numbers : [numbers])
    .map((value) => String(value || "").replace(/\D/g, ""))
    .filter((value) => /^\d{7,15}$/.test(value)))].slice(0, 50);
  if (!input.length) return [];
  const results = await socket.onWhatsApp(...input);
  return input.map((phoneNumber) => {
    const row = results.find((item) =>
      String(item?.jid || "").replace(/\D/g, "") === phoneNumber
    );
    return {
      phoneNumber,
      exists: Boolean(row?.exists),
      jid: row?.jid || "",
    };
  });
}

async function getPrivacySettings(force = true) {
  if (!socket || connection !== "connected") throw new Error("WhatsApp 尚未连接");
  return socket.fetchPrivacySettings(Boolean(force));
}

async function updatePrivacySettings(patch = {}) {
  if (!socket || connection !== "connected") throw new Error("WhatsApp 尚未连接");
  const methods = {
    lastSeen: "updateLastSeenPrivacy",
    online: "updateOnlinePrivacy",
    profilePicture: "updateProfilePicturePrivacy",
    status: "updateStatusPrivacy",
    readReceipts: "updateReadReceiptsPrivacy",
    groupsAdd: "updateGroupsAddPrivacy",
  };
  for (const [key, method] of Object.entries(methods)) {
    if (patch[key] !== undefined && typeof socket[method] === "function") {
      await socket[method](String(patch[key]));
    }
  }
  if (patch.defaultDisappearing !== undefined) {
    await socket.updateDefaultDisappearingMode(
      Math.max(0, Number(patch.defaultDisappearing) || 0)
    );
  }
  return getPrivacySettings(true);
}

function statusPayload() {
  const socketUser = socket?.user || null;
  const credentialUser = authMe || null;
  const user = socketUser || credentialUser
    ? {
        ...(credentialUser || {}),
        ...(socketUser || {}),
        // socket.user often contains only the phone number; keep the
        // push name from creds.me when that is the only human-readable name.
        name: credentialUser?.name || socketUser?.name || undefined,
      }
    : null;
  // 有登录身份且正在重连：前端应显示「重连中」而不是「扫码」
  const me = user?.id || user?.name || null;
  return {
    protocolVersion: BAILEYS_BRIDGE_PROTOCOL_VERSION,
    baileysVersion: BAILEYS_LIBRARY_VERSION,
    connection,
    qrDataUrl: connection === "qr" ? qrDataUrl : "",
    user,
    lastError,
    hasQr: connection === "qr" && Boolean(qrDataUrl),
    reconnectAttempts,
    lastDisconnectAt,
    signedIn: Boolean(me) || connection === "connected" || connection === "reconnecting",
    presenceEventCount,
    lastPresenceDebug,
    eventCursor: sequence,
  };
}


function getHttpDeps() {
  return {
    get token() {
      return token;
    },
    get port() {
      return port;
    },
    get events() {
      return events;
    },
    get sequence() {
      return sequence;
    },
    get eventsDroppedThrough() {
      return eventsDroppedThrough;
    },
    get connection() {
      return connection;
    },
    set connection(v) {
      connection = v;
    },
    get qrDataUrl() {
      return qrDataUrl;
    },
    set qrDataUrl(v) {
      qrDataUrl = v;
    },
    get lastError() {
      return lastError;
    },
    set lastError(v) {
      lastError = v;
    },
    get socket() {
      return socket;
    },
    get messages() {
      return messages;
    },
    get contacts() {
      return contacts;
    },
    get accountId() {
      return accountId;
    },
    get labels() {
      return labels;
    },
    get chatLabelIds() {
      return chatLabelIds;
    },
    get products() {
      return products;
    },
    statusPayload,
    snapshot,
    scheduleAvatarsForActive,
    hydrateGroupSubjects,
    groupService,
    groupWriteService,
    blocklistService,
    ingestStoreChats(chats) {
      for (const chat of chats || []) {
        try {
          applyChatRecord(chat);
        } catch {
          /* ignore */
        }
      }
      recoverChatLastMessages(chats, "socket.store");
    },
    ingestStoreContacts(people) {
      for (const item of people || []) {
        try {
          upsertWaContact(item);
        } catch {
          /* ignore */
        }
      }
    },
    findContactByAnyJid,
    enqueueAvatar,
    fetchAvatarHd,
    fetchAvatarForJids,
    selfJidCandidates,
    resolveSendJid,
    requestPairingCode,
    checkWhatsAppNumbers,
    getPrivacySettings,
    updatePrivacySettings,
    mediaToDataUrl,
    findStoredMessageByKey,
    upsertContact,
    rawWaByMsgId,
    loadRawWaById: rawMediaStore.load,
    getRawWaByKey,
    requestFullHistorySync,
    connect,
    push,
  };
}

startBaileysHttpServer(port, getHttpDeps);
