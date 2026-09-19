import {
  clearAppState,
  loadAppState,
  loadSecureSecrets,
  saveAppState,
  saveSecureSecrets,
} from "@/lib/storage";
import { parseBackupJson, readJsonFile } from "@/lib/exportData";
import { buildPersonKey, looksLikeMessageAsName } from "@/lib/utils";
import { healSingleSessionOwnership } from "@/lib/accounts";
import { normalizeCampaigns } from "@/lib/broadcastCampaign";
import { calcStats } from "./calcStats";
import { cleanHydratedMessages, recoverInterruptedMessage } from "./hydrateMessageCleanup";
import { isHiddenProtocolMessageBody } from "./messageOrdering";
import { dedupePhones } from "./deviceIngest";
import { DEFAULT_ACCOUNT_ID } from "@/types/account";
import {
  defaultSettings,
  normalizeLoadedSettings,
} from "./settingsDefaults";
import type {
  AppSettings,
  AppState,
  PersistSlice,
  SliceContext,
} from "./types";
import { restoreLocalContactChats } from "./localContactChats";
import { pruneChatFolderRefs } from "./chatFolderCleanup";
import { mergeImportedContactChatDuplicates } from "./chatDuplicateMerge";
import { clearTrendBuckets } from "./trendBuckets";
import { flushPersist } from "./persist";

const blankData = (settings: AppSettings = defaultSettings as AppSettings): PersistSlice => ({
  phones: [],
  contacts: [],
  chats: [],
  messages: [],
  followUps: [],
  scheduledMessages: [],
  activities: [],
  settings,
  broadcastCampaigns: [],
});

export function createBootSlice({
  set,
  get,
}: SliceContext): Pick<AppState, "hydrate" | "clearData" | "importBackup"> {
  return {
    hydrate: async () => {
      const hydrateStarted = performance.now();
      const markHydrate = (phase: string) =>
        console.info(
          `[startup] hydrate-${phase} ${(performance.now() - hydrateStarted).toFixed(0)}ms`
        );
      const [saved, loadedSecrets] = await Promise.all([
        loadAppState<Partial<PersistSlice>>(),
        loadSecureSecrets(),
      ]);
      markHydrate("storage-return");
      let secureSecrets = loadedSecrets;
      markHydrate("secure");
      const legacySecrets = saved?.settings as Partial<AppSettings> | undefined;
      if (
        !secureSecrets &&
        (legacySecrets?.openaiKey ||
          legacySecrets?.groqKey ||
          legacySecrets?.geminiKey ||
          legacySecrets?.deepseekKey ||
          legacySecrets?.qwenKey ||
          legacySecrets?.zhipuKey ||
          legacySecrets?.openrouterKey ||
          legacySecrets?.customAiKey ||
          legacySecrets?.bridgeToken)
      ) {
        const migrated = await saveSecureSecrets({
          openaiKey: legacySecrets.openaiKey || "",
          groqKey: legacySecrets.groqKey || "",
          geminiKey: legacySecrets.geminiKey || "",
          deepseekKey: legacySecrets.deepseekKey || "",
          qwenKey: legacySecrets.qwenKey || "",
          zhipuKey: legacySecrets.zhipuKey || "",
          openrouterKey: legacySecrets.openrouterKey || "",
          customAiKey: legacySecrets.customAiKey || "",
          bridgeToken: legacySecrets.bridgeToken || "",
        });
        if (migrated) {
          secureSecrets = {
            openaiKey: legacySecrets.openaiKey || "",
            groqKey: legacySecrets.groqKey || "",
            geminiKey: legacySecrets.geminiKey || "",
            deepseekKey: legacySecrets.deepseekKey || "",
            qwenKey: legacySecrets.qwenKey || "",
            zhipuKey: legacySecrets.zhipuKey || "",
            openrouterKey: legacySecrets.openrouterKey || "",
            customAiKey: legacySecrets.customAiKey || "",
            bridgeToken: legacySecrets.bridgeToken || "",
          };
        }
      }
      const legacyDemo = saved?.phones?.some((phone) => phone.id === "phone-fr");
      const rawChats = legacyDemo ? [] : saved?.chats ?? [];
      const rawMessages = legacyDemo ? [] : saved?.messages ?? [];
      // 去掉历史「本地乐观 + WA 回声」重复出站气泡；丢掉错误落库的 [表情] 气泡
      let messages = cleanHydratedMessages(rawMessages);
      markHydrate("messages");
      const msgChatIds = new Set(messages.map((m) => m.chatId));
      // 启动时：保留有消息的会话；也保留带 accountId 的预览行（多号通讯录同步常无消息体）
      // 启动：尽量保留已落库会话，避免「有联系人无预览」被滤光后写回空列表
      let chats = rawChats.filter((c) => {
        if (msgChatIds.has(c.id)) return true;
        if (c.lastMessage && c.lastMessage.trim()) return true;
        if (c.pinned || c.archived || (c.unread || 0) > 0) return true;
        if (c.contactId) return true;
        if (c.accountId) return true;
        return false;
      });
      // 预览若被旧版协议占位符污染，用真实最后一条盖回
      const stalePreviewChatIds = new Set(
        chats
          .filter(
            (ch) =>
              /^\[表情\]/.test((ch.lastMessage || "").trim()) ||
              isHiddenProtocolMessageBody(ch.lastMessage)
          )
          .map((ch) => ch.id)
      );
      if (stalePreviewChatIds.size) {
        const latestByChat = new Map<string, import("@/types/crm").Message>();
        for (const message of messages) {
          if (!stalePreviewChatIds.has(message.chatId)) continue;
          const previous = latestByChat.get(message.chatId);
          if (!previous || message.sentAt > previous.sentAt) {
            latestByChat.set(message.chatId, message);
          }
        }
        chats = chats.map((ch) => {
          if (!stalePreviewChatIds.has(ch.id)) return ch;
          const last = latestByChat.get(ch.id);
          return last
            ? {
                ...ch,
                lastMessage: last.body,
                lastMessageDirection: last.direction,
                updatedAt: last.sentAt,
              }
            : { ...ch, lastMessage: "" };
        });
      }
      const placeholder = (n?: string) => {
        const t = (n || "").trim().toLowerCase();
        return (
          !t ||
          t === "未知联系人" ||
          t === "未知" ||
          t === "unknown" ||
          t === "号码解析中…" ||
          t === "号码解析中..." ||
          t === "未备注联系人" ||
          /^\d{10,}$/.test(t) ||
          looksLikeMessageAsName(n)
        );
      };
      const savedContacts = legacyDemo ? [] : saved?.contacts ?? [];
      const removedDefaultSources = savedContacts.some((c) => c.source === "WhatsApp");
      const settingsNorm = normalizeLoadedSettings({
        ...(saved?.settings as Partial<AppSettings> | undefined),
        ...(secureSecrets || {}),
      }) as AppSettings;
      // 旧数据：有明确 accountId/bound 保留；纯孤儿不要强行标成当前 live（会串到第二号）
      const fallbackAccountId =
        settingsNorm.liveBaileysAccountId ||
        settingsNorm.activeAccountId ||
        DEFAULT_ACCOUNT_ID;
      const knownAccountIds = new Set(
        (settingsNorm.waAccounts || []).map((a) => a.id)
      );
      let contacts = savedContacts.map((storedContact) => {
        const c = storedContact.source === "WhatsApp"
          ? { ...storedContact, source: undefined }
          : storedContact;
        const phone = (c.phone || "").trim();
        // boundPhoneId 若是 wa-* 优先作 accountId（多号正确归属）
        const fromBound =
          c.boundPhoneId &&
          (String(c.boundPhoneId).startsWith("wa-") ||
            c.boundPhoneId === "baileys" ||
            c.boundPhoneId === DEFAULT_ACCOUNT_ID)
            ? String(c.boundPhoneId)
            : "";
        const existing = (c.accountId || "").trim();
        const accountId =
          (existing && knownAccountIds.has(existing) ? existing : "") ||
          fromBound ||
          // 仅当只有一个账号槽时，才把孤儿归默认号
          (knownAccountIds.size <= 1 ? fallbackAccountId : existing || fromBound || fallbackAccountId);
        let next = {
          ...c,
          accountId,
          personKey:
            c.personKey ||
            buildPersonKey({
              phone: c.phone,
              channelAddress: c.channelAddress,
              isGroup: c.isGroup,
            }),
        };
        if (phone && placeholder(next.name)) {
          next = { ...next, name: phone };
        } else if (placeholder(next.name)) {
          // 清掉占位 / 消息当名，留给 UI 用 displayContactLabel
          next = { ...next, name: phone || "" };
        }
        return next;
      });
      markHydrate("contacts");
      // 丢掉「仅单字母/本人昵称 + 无手机号」的幽灵联系人（如登录名 E）
      const ghostContact = (c: { name?: string; phone?: string }) => {
        const n = (c.name || "").trim();
        const p = (c.phone || "").trim();
        if (p) return false;
        if (!n) return false;
        // 单字符或仅 1～2 个字母且无号码 → 高概率是自己/脏数据
        if (/^[A-Za-zÀ-ÿ]$/.test(n)) return true;
        return false;
      };
      const ghostIds = new Set(
        contacts.filter(ghostContact).map((c) => c.id)
      );
      if (ghostIds.size) {
        contacts = contacts.filter((c) => !ghostIds.has(c.id));
        const dropChatIds = new Set(
          chats
            .filter((ch) => ghostIds.has(ch.contactId))
            .map((ch) => ch.id)
        );
        chats = chats.filter((ch) => !ghostIds.has(ch.contactId));
        for (let i = messages.length - 1; i >= 0; i--) {
          if (dropChatIds.has(messages[i]!.chatId)) messages.splice(i, 1);
        }
      }
      // 会话标题跟着改：占位或消息正文名 → 联系人名/号码/空
      const nameById = new Map(contacts.map((c) => [c.id, c.name]));
      const contactById = new Map(contacts.map((c) => [c.id, c]));
      const accountByContact = new Map(
        contacts.map((c) => [c.id, c.accountId || ""])
      );
      // 会话标题 + 多号归属回填（不可把账号2 会话并进 live）
      chats = chats.map((ch) => {
        let contactName = ch.contactName;
        if (placeholder(contactName)) {
          const n = nameById.get(ch.contactId);
          if (n && !placeholder(n)) contactName = n;
          else {
            const c = contactById.get(ch.contactId);
            contactName = c?.phone || "";
          }
        }
        const fromPhone =
          ch.phoneId &&
          (String(ch.phoneId).startsWith("wa-") || ch.phoneId === "baileys")
            ? String(ch.phoneId)
            : "";
        const accountId =
          ch.accountId ||
          accountByContact.get(ch.contactId) ||
          fromPhone ||
          fallbackAccountId;
        return {
          ...ch,
          contactName,
          accountId,
          phoneId: ch.phoneId || accountId,
        };
      });
      const chatsBeforeLocalRestore = chats;
      chats = restoreLocalContactChats(chats, contacts);
      const restoredLocalChats = chats !== chatsBeforeLocalRestore;
      const mergedLocalChats = mergeImportedContactChatDuplicates(
        chats,
        messages
      );
      chats = mergedLocalChats.chats;
      messages = mergedLocalChats.messages;
      const cleanedFolderRefs = pruneChatFolderRefs(
        settingsNorm.chatFolders || [],
        settingsNorm.chatFolderClones || [],
        new Set(chats.map((chat) => chat.id)),
        mergedLocalChats.replacements
      );
      settingsNorm.chatFolders = cleanedFolderRefs.folders;
      settingsNorm.chatFolderClones = cleanedFolderRefs.clones;
      markHydrate("chats");
      // 消息补 accountId，便于会话气泡按号过滤
      const chatOwner = new Map(
        chats.map((ch) => [ch.id, ch.accountId || ch.phoneId || ""])
      );
      for (let i = 0; i < messages.length; i++) {
        const m = messages[i]!;
        messages[i] = {
          ...m,
          accountId:
            m.accountId ||
            m.deviceId ||
            chatOwner.get(m.chatId) ||
            fallbackAccountId,
        };
      }

      const healed = healSingleSessionOwnership({
        contacts,
        chats,
        folders: settingsNorm.chatFolders || [],
        accounts: settingsNorm.waAccounts || [],
        liveAccountId:
          settingsNorm.liveBaileysAccountId ||
          settingsNorm.activeAccountId ||
          DEFAULT_ACCOUNT_ID,
        activeAccountId: settingsNorm.activeAccountId || DEFAULT_ACCOUNT_ID,
      });
      contacts = healed.contacts;
      chats = healed.chats;
      settingsNorm.chatFolders = healed.folders as AppSettings["chatFolders"];
      settingsNorm.waAccounts = healed.accounts;
      settingsNorm.liveBaileysAccountId = healed.liveAccountId;
      settingsNorm.activeAccountId = healed.activeAccountId;
      // 保留上次浏览的账号（或“全部账号”）；仅当该槽已被清理时才回退。
      const restoredView = settingsNorm.accountViewMode;
      if (
        restoredView.type === "account" &&
        !healed.accounts.some(
          (account) => account.id === restoredView.accountId
        )
      ) {
        settingsNorm.accountViewMode = {
          type: "account",
          accountId: healed.viewAccountId,
        };
      }
      markHydrate("ownership");

      const rawPhones = legacyDemo ? [] : saved?.phones ?? [];
      const phonesClean = dedupePhones(rawPhones);
      const phonesChanged =
        phonesClean.length !== rawPhones.length ||
        phonesClean.some((p, i) => p.id !== rawPhones[i]?.id);

      // 上次发送可能已成功，结果未知的请求仅允许核对后手动重试。
      let recoveredPending = 0;
      for (let i = 0; i < messages.length; i++) {
        const m = messages[i]!;
        const recovered = recoverInterruptedMessage(m);
        if (recovered === m) continue;
        messages[i] = recovered;
        recoveredPending++;
      }
      if (recoveredPending > 0) {
        console.info(
          `[startup] recovered ${recoveredPending} interrupted outgoing message(s)`
        );
      }

      const slice: PersistSlice = {
        phones: phonesClean,
        contacts,
        chats,
        messages,
        followUps: legacyDemo ? [] : saved?.followUps ?? [],
        scheduledMessages: settingsNorm.scheduledMessages ?? [],
        activities: legacyDemo ? [] : saved?.activities ?? [],
        settings: settingsNorm,
        broadcastCampaigns: normalizeCampaigns(saved?.broadcastCampaigns),
      };
      markHydrate("ready");
      // 启动/刷新：不自动打开某个会话（对齐官方 WA 空白欢迎页）
      // stats 延后一帧算，避免 hydrate set 与大列表首渲同帧
      set({
        ...slice,
        stats: get().stats,
        selectedPhoneId:
          slice.phones.find((p) => p.id === "baileys")?.id ??
          slice.phones[0]?.id ??
          null,
        selectedContactId: null,
        selectedChatId: null,
        aiSuggestions: [],
        hydrated: true,
      });
      queueMicrotask(() => {
        try {
          get().recomputeStats();
        } catch {
          /* ignore */
        }
      });
      if (
        legacyDemo ||
        chats.length !== rawChats.length ||
        removedDefaultSources ||
        restoredLocalChats ||
        mergedLocalChats.changed ||
        cleanedFolderRefs.changed ||
        healed.changed ||
        phonesChanged || recoveredPending > 0
      ) {
        // 启动写盘再拖后一点，别和首屏抢
        window.setTimeout(() => {
          flushPersist(get);
        }, 2500);
      }
    },

    clearData: async () => {
      const currentSettings = get().settings;
      const folderRefs = pruneChatFolderRefs(
        currentSettings.chatFolders || [],
        currentSettings.chatFolderClones || [],
        new Set()
      );
      const settings = {
        ...currentSettings,
        chatFolders: folderRefs.folders,
        chatFolderClones: folderRefs.clones,
        scheduledMessages: [],
        internalNotesByKey: {},
        personPrimaryAccountByKey: {},
      };
      await clearAppState();
      clearTrendBuckets();
      const base = blankData(settings);
      set({
        ...base,
        stats: calcStats(base.chats, base.followUps, base.contacts, base.messages),
        selectedPhoneId: base.phones[0]?.id ?? null,
        selectedContactId: null,
        selectedChatId: null,
        aiSuggestions: [],
        draftReply: "",
        draftReplyByChatId: {},
        activeNav: "chats",
        hydrated: true,
      });
      await saveAppState(base, { force: true });
    },

    importBackup: async (bundle) => {
      try {
        const raw = bundle instanceof File ? await readJsonFile(bundle) : bundle;
        const parsed = parseBackupJson(raw);
        const currentSettings = get().settings;
        const settings = normalizeLoadedSettings({
          ...currentSettings,
          ...(parsed.settingsSafe || {}),
          openaiKey: currentSettings.openaiKey,
          groqKey: currentSettings.groqKey,
          geminiKey: currentSettings.geminiKey,
          deepseekKey: currentSettings.deepseekKey,
          qwenKey: currentSettings.qwenKey,
          zhipuKey: currentSettings.zhipuKey,
          openrouterKey: currentSettings.openrouterKey,
        }) as AppSettings;
        const slice: PersistSlice = {
          phones: parsed.phones,
          contacts: parsed.contacts,
          chats: parsed.chats,
          messages: parsed.messages,
          followUps: parsed.followUps,
          scheduledMessages: settings.scheduledMessages ?? [],
          activities: parsed.activities,
          settings,
          broadcastCampaigns: normalizeCampaigns(parsed.broadcastCampaigns),
        };
        const previous = get();
        const rollback = {
          phones: previous.phones,
          contacts: previous.contacts,
          chats: previous.chats,
          messages: previous.messages,
          followUps: previous.followUps,
          scheduledMessages: previous.scheduledMessages,
          activities: previous.activities,
          settings: previous.settings,
          broadcastCampaigns: previous.broadcastCampaigns,
          stats: previous.stats,
          selectedPhoneId: previous.selectedPhoneId,
          selectedContactId: previous.selectedContactId,
          selectedChatId: previous.selectedChatId,
          aiSuggestions: previous.aiSuggestions,
          draftReply: previous.draftReply,
          draftReplyByChatId: previous.draftReplyByChatId,
          activeNav: previous.activeNav,
        };
        set({
          ...slice,
          selectedPhoneId: slice.phones[0]?.id ?? null,
          selectedContactId: null,
          selectedChatId: null,
          aiSuggestions: [],
          draftReply: "",
          draftReplyByChatId: {},
          activeNav: "chats",
        });
        try {
          await saveAppState(
            { ...slice, replaceMessages: true },
            { force: true }
          );
        } catch (error) {
          set(rollback);
          throw error;
        }
        clearTrendBuckets();
        get().recomputeStats();
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}
