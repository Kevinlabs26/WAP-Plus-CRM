import {
  Captions,
  ContactRound,
  Image,
  Loader2,
  Paperclip,
  Plus,
  Reply,
  ShoppingBag,
  Smile,
  X,
  Zap,
} from "lucide-react";
import {
  lazy,
  memo,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Contact } from "@/types/crm";
import { useAppStore, type AppSettings } from "@/store/appStore";
import { useShallow } from "zustand/react/shallow";
import { cn } from "@/lib/utils";
import {
  getRecentMainThreadWork,
  isTypingDiagnosticsEnabled,
  syncLog,
} from "@/lib/syncDebug";
import {
  langShortLabel,
  resolveTargetLang,
  translateDraftText,
} from "@/lib/translateDraft";
import { Textarea } from "@/components/ui/primitives";
import { MentionPicker } from "@/components/chat/MentionPicker";
import {
  applyMentionInsert,
  filterMentionCandidates,
  mentionQueryAt,
  type MentionCandidate,
} from "@/lib/groupMention";
import { MediaSendPreview } from "./MediaSendPreview";
import { SendVoiceToggle } from "./SendVoiceToggle";
import { TranslateBar } from "./TranslateBar";
import { VoiceRecordingControls } from "./VoiceRecordingControls";
import { useComposerPresence } from "./useComposerPresence";
import type { ComposerPresenceTarget } from "./useComposerPresence";
import { useComposerMedia } from "./useComposerMedia";
import { useComposerVoiceInput } from "./useComposerVoiceInput";
import { markComposerInput } from "@/lib/composerActivity";
import { VOICE_INPUT_LANGUAGES } from "@/lib/voiceInputLanguage";
import { getChatDraftValue } from "@/lib/chatDrafts";
import { toggleComposerBold } from "@/lib/composerFormatting";
import { useI18n } from "@/i18n";

const TYPING_DEBUG_ENABLED = isTypingDiagnosticsEnabled();
const EmojiStickerGifPanel = lazy(() =>
  import("./EmojiStickerGifPanel").then((m) => ({
    default: m.EmojiStickerGifPanel,
  }))
);

export type ComposerReplyTo = {
  id: string;
  body: string;
  direction: "in" | "out";
};

type Props = {
  /** 切换会话时重置本地 UI（附件菜单、翻译底稿等） */
  resetKey?: string | null;
  /** 可选；默认走 store，避免父组件订 draft 每键重渲 */
  draftReply?: string;
  setDraftReply?: (text: string) => void;
  sending: boolean;
  isBaileys: boolean;
  baileysConnected: boolean;
  /** 可选；默认 Composer 内窄订阅 settings，避免 ChatPanel 背整包 */
  settings?: AppSettings;
  activeContact?: Contact;
  /** 客户最近一条入站消息正文：无 preferredLang 时自动检测译出语，省去每个会话手选 */
  lastInboundBody?: string;
  updateContact: (id: string, patch: Partial<Contact>) => void;
  pushToast: (message: string, tone?: "info" | "success" | "error") => void;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  replyTo: ComposerReplyTo | null;
  setReplyTo: (v: ComposerReplyTo | null) => void;
  recording: boolean;
  voicePaused: boolean;
  recordSec: number;
  onSend: () => void | Promise<void>;
  /** ↑ 空输入框时编辑最近一条自己发送的文字消息。 */
  onEditLatest?: () => boolean;
  onSendImage: (file: File, caption?: string) => boolean | Promise<boolean>;
  onSendAudio: (file: File, caption?: string) => boolean | Promise<boolean>;
  onSendSticker: (file: File) => boolean | Promise<boolean>;
  onSendGif: (file: File, caption?: string) => boolean | Promise<boolean>;
  recentStickers: string[];
  onSendRecentSticker: (dataUrl: string) => void | Promise<void>;
  favoriteStickers: string[];
  onRemoveFavoriteSticker: (dataUrl: string) => void;
  onSendFile: (file: File, caption?: string) => boolean | Promise<boolean>;
  onOpenCatalog: () => void;
  onOpenContactPicker: () => void;
  onBeginVoice: () => void | Promise<void>;
  readVoiceLevel: () => number;
  onToggleVoicePause: () => void;
  onEndVoice: (send: boolean) => void | Promise<void>;
  /** 输入时 presence 目标；无则不发 composing */
  resolvePresenceTarget?: () => ComposerPresenceTarget | null;
  /** 群成员（@ 选择器） */
  groupMembers?: { jid: string; label: string; phoneE164?: string }[];
  /** 与父组件共享的 mention 跟踪（发送时解析 jid） */
  mentionTrackerRef?: React.MutableRefObject<
    { token: string; jid: string; everyone?: boolean }[]
  >;
  /** 启动暖机未完成时禁用输入，避免打字跟不上 */
  uiReady?: boolean;
};

/**
 * 聊天输入条：附件 / 话术 / 文本 / 语音 / 发送 / 翻译。
 * 发送与录音业务由父组件注入，避免重复协议逻辑。
 */
function ComposerInner({
  resetKey,
  draftReply: draftReplyProp,
  setDraftReply: setDraftReplyProp,
  sending,
  isBaileys,
  baileysConnected,
  settings: settingsProp,
  activeContact,
  lastInboundBody,
  updateContact,
  pushToast,
  editingId,
  setEditingId,
  replyTo,
  setReplyTo,
  recording,
  voicePaused,
  recordSec,
  onSend,
  onEditLatest,
  onSendImage,
  onSendAudio,
  onSendSticker,
  onSendGif,
  recentStickers,
  onSendRecentSticker,
  favoriteStickers,
  onRemoveFavoriteSticker,
  onSendFile,
  onOpenCatalog,
  onOpenContactPicker,
  onBeginVoice,
  readVoiceLevel,
  onToggleVoicePause,
  onEndVoice,
  resolvePresenceTarget,
  groupMembers,
  mentionTrackerRef,
  uiReady = true,
}: Props) {
  const { t } = useI18n();
  const traceRenderStart = TYPING_DEBUG_ENABLED ? performance.now() : 0;
  const inputLocked = !uiReady;
  // 渲染只订会进 UI 的 settings 字段；翻译密钥等在点击时 getState()
  const settingsUi = useAppStore(
    useShallow((s) => ({
      translateTargetLang: s.settings.translateTargetLang,
      voiceInputLang: s.settings.voiceInputLang,
    }))
  );
  const crmPanelCollapsed = useAppStore((s) => s.crmPanelCollapsed);
  const crmPanelTab = useAppStore((s) => s.crmPanelTab);
  const settings: AppSettings =
    settingsProp ||
    ({
      ...useAppStore.getState().settings,
      translateTargetLang: settingsUi.translateTargetLang,
      voiceInputLang: settingsUi.voiceInputLang,
    } as AppSettings);
  const fullSettings = (): AppSettings =>
    settingsProp || useAppStore.getState().settings;
  // 不订阅 draftReply：否则防抖写回 store 仍会触发 Composer 重挂
  const setDraftReply =
    setDraftReplyProp || ((t: string) => useAppStore.getState().setDraftReply(t));
  const initialDraft = (() => {
    if (draftReplyProp !== undefined) return draftReplyProp;
    const state = useAppStore.getState();
    return getChatDraftValue(state.draftReplyByChatId, resetKey);
  })();
  const [dragOver, setDragOver] = useState(false);
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [mentionQuery, setMentionQuery] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const trackedMentionsRef = useRef<
    { token: string; jid: string; everyone?: boolean }[]
  >([]);
  const [translateLang, setTranslateLang] = useState("en");
  const [translating, setTranslating] = useState(false);
  const [translateOriginal, setTranslateOriginal] = useState<string | null>(
    null
  );
  /**
   * 非受控草稿：按键只写 textarea DOM + ref，不 setState。
   * 仅在「空 ↔ 非空」边界更新 hasDraft，用来切换发送/语音按钮与翻译条。
   */
  const draftRef = useRef(initialDraft);
  const lastFlushedDraftRef = useRef(initialDraft);
  const [hasDraft, setHasDraft] = useState(() => Boolean(initialDraft.trim()));
  const hasDraftRef = useRef(Boolean(initialDraft.trim()));
  const composingRef = useRef(false);
  const mentionTimerRef = useRef<number | null>(null);
  const resizeTimerRef = useRef<number | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const stickerInputRef = useRef<HTMLInputElement | null>(null);
  const gifInputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const emojiPanelRef = useRef<HTMLDivElement | null>(null);
  const voiceLanguageRef = useRef<HTMLDivElement | null>(null);
  const lastLatencyLogAt = useRef(0);
  const { emitComposing, scheduleComposing } = useComposerPresence({
    isBaileys,
    baileysConnected,
    resolvePresenceTarget,
  });

  useEffect(() => {
    if (!traceRenderStart) return;
    const durationMs = performance.now() - traceRenderStart;
    if (durationMs < 8) return;
    const recentWork = getRecentMainThreadWork();
    syncLog(
      "typing",
      "composer commit slow",
      {
        durationMs: Math.round(durationMs),
        draftLength: draftRef.current.length,
        recentWorkName: recentWork?.name,
        recentWorkDurationMs: recentWork?.durationMs,
      },
      durationMs >= 16 ? "warn" : "debug"
    );
  });

  const readDraft = () => {
    const el = textareaRef.current;
    if (el) draftRef.current = el.value;
    return draftRef.current;
  };

  const traceInputLatency = (eventTimeStamp: number, draftLength: number) => {
    if (!TYPING_DEBUG_ENABLED) return;
    const handlerAt = performance.now();
    const eventAt =
      eventTimeStamp > 0 && Math.abs(handlerAt - eventTimeStamp) < 60_000
        ? eventTimeStamp
        : handlerAt;
    const inputDelayMs = handlerAt - eventAt;
    // 每 250ms 采一次样，无论快慢都上报，用来观察「每个键的实际延迟分布」
    requestAnimationFrame(() => {
      const paintDelayMs = performance.now() - eventAt;
      const now = Date.now();
      if (now - lastLatencyLogAt.current < 250) return;
      lastLatencyLogAt.current = now;
      const state = useAppStore.getState();
      const selectedChat = state.chats.find(
        (chat) => chat.id === state.selectedChatId
      );
      const recentWork = getRecentMainThreadWork();
      syncLog(
        "typing",
        "keystroke sample",
        {
          inputDelayMs: Math.round(inputDelayMs),
          paintDelayMs: Math.round(paintDelayMs),
          draftLength,
          composing: composingRef.current,
          messages: state.messages.length,
          contacts: state.contacts.length,
          chats: state.chats.length,
          recentWorkName: recentWork?.name,
          recentWorkDurationMs: recentWork?.durationMs,
          accountId:
            state.selectedThreadAccount?.accountId ||
            selectedChat?.accountId ||
            null,
        },
        "warn"
      );
    });
  };

  const updateHasDraft = (text: string) => {
    const next = /\S/.test(text);
    if (hasDraftRef.current === next) return;
    hasDraftRef.current = next;
    setHasDraft(next);
  };

  const scheduleTextareaResize = () => {
    if (resizeTimerRef.current != null) {
      window.clearTimeout(resizeTimerRef.current);
    }
    resizeTimerRef.current = window.setTimeout(() => {
      resizeTimerRef.current = null;
      const el = textareaRef.current;
      if (!el) return;
      // 发送后是程序化清空，不会触发 onChange；空内容必须主动恢复单行高度。
      if (!el.value) {
        if (el.clientHeight !== 36) {
          el.style.height = "36px";
        }
        return;
      }
      // scrollHeight 即内容高度（含未显示行），无需先置 height:auto 再读（避免二次失效布局）。
      // 仅当目标高度与当前不同才写 style，单行打字时不再反复触发 reflow。
      const target = Math.max(36, Math.min(el.scrollHeight, 144));
      const cur = el.clientHeight;
      if (cur !== target) {
        el.style.height = `${target}px`;
      }
    }, 160);
  };

  const applyDraftToDom = (text: string) => {
    draftRef.current = text;
    const el = textareaRef.current;
    if (el && el.value !== text) el.value = text;
    scheduleTextareaResize();
    updateHasDraft(text);
  };

  const flushDraftNow = (text: string) => {
    lastFlushedDraftRef.current = text;
    draftRef.current = text;
    const cur = useAppStore.getState().draftReply;
    if (text !== cur) setDraftReply(text);
    updateHasDraft(text);
  };

  /** 程序化改草稿（表情/话术/mention/翻译）；打字路径不走这里 */
  const setDraftLocal = (text: string) => {
    applyDraftToDom(text);
  };

  const {
    pendingMedia,
    setMediaCaption,
    mediaSendingIndex,
    stageMedia,
    removeMedia,
    closeMediaPreview,
    sendPendingMedia,
    handleComposerPaste,
  } = useComposerMedia({
    chatKey: resetKey || "default",
    readDraft,
    setDraftLocal,
    flushDraftNow,
    onSendImage,
    onSendAudio,
    onSendSticker,
    onSendGif,
    onSendFile,
    onStageMedia: () => {
      setAttachmentOpen(false);
      setEmojiOpen(false);
    },
  });

  // WebView2 下 React 合成 drop 事件不可靠（项目曾遇 dataTransfer 为空/被拦），
  // 改用原生 window 级捕获监听 + files/items 双重读取，落区覆盖整个聊天面板（消息区 + 输入框）。
  const stageMediaRef = useRef(stageMedia);
  stageMediaRef.current = stageMedia;
  const dragDepthRef = useRef(0);
  useEffect(() => {
    const filesFromTransfer = (transfer: DataTransfer | null) => {
      if (!transfer) return [] as File[];
      const files = Array.from(transfer.files || []);
      if (files.length) return files;
      return Array.from(transfer.items || [])
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));
    };
    const hasFiles = (transfer: DataTransfer | null) =>
      Boolean(
        transfer &&
          (Array.from(transfer.files || []).length > 0 ||
            Array.from(transfer.items || []).some((item) => item.kind === "file"))
      );
    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      dragDepthRef.current += 1;
      setDragOver(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      setDragOver(true);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      dragDepthRef.current = 0;
      setDragOver(false);
      const files = filesFromTransfer(e.dataTransfer);
      if (files.length) stageMediaRef.current(files);
    };
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (!dragDepthRef.current) setDragOver(false);
    };
    const onDragEnd = () => {
      dragDepthRef.current = 0;
      setDragOver(false);
    };
    const onWindowBlur = () => setDragOver(false);
    let unlistenTauriDrop: (() => void) | undefined;
    void (async () => {
      try {
        const [{ getCurrentWindow }, { invoke }] = await Promise.all([
          import("@tauri-apps/api/window"),
          import("@tauri-apps/api/core"),
        ]);
        unlistenTauriDrop = await getCurrentWindow().onDragDropEvent(async (event) => {
          if (event.payload.type === "enter" || event.payload.type === "over") {
            dragDepthRef.current = 1;
            setDragOver(true);
            return;
          }
          if (event.payload.type !== "drop") return;
          dragDepthRef.current = 0;
          setDragOver(false);
          const files = await Promise.all(
            event.payload.paths.slice(0, 5).map(async (path) => {
              const dropped = await invoke<{
                name: string;
                mime: string;
                bytes: number[];
              }>("read_dropped_file", { path });
              return new File([new Uint8Array(dropped.bytes)], dropped.name, {
                type: dropped.mime,
              });
            })
          );
          if (files.length) stageMediaRef.current(files);
        });
      } catch {
        // 浏览器开发模式没有 Tauri API，依赖上面的 HTML5 监听即可。
      }
    })();
    window.addEventListener("dragenter", onDragEnter, true);
    window.addEventListener("dragover", onDragOver, true);
    window.addEventListener("drop", onDrop, true);
    window.addEventListener("dragleave", onDragLeave, true);
    window.addEventListener("dragend", onDragEnd, true);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("dragenter", onDragEnter, true);
      window.removeEventListener("dragover", onDragOver, true);
      window.removeEventListener("drop", onDrop, true);
      window.removeEventListener("dragleave", onDragLeave, true);
      window.removeEventListener("dragend", onDragEnd, true);
      window.removeEventListener("blur", onWindowBlur);
      unlistenTauriDrop?.();
    };
  }, []);

  const {
    voiceInputOpen,
    voiceInputBusy,
    voiceInputEngineLabel,
    voiceLanguageOpen,
    setVoiceLanguageOpen,
    handleToggleVoiceInput,
    handleCancelVoiceInput,
    resetVoiceInput,
  } = useComposerVoiceInput({
    editingId,
    pushToast,
    fullSettings,
    setDraftLocal,
    flushDraftNow,
    focusTextarea: () =>
      textareaRef.current?.focus({ preventScroll: true }),
  });

  // 外部改 draft（AI 建议、编辑填入、发送后清空）
  useEffect(() => {
    return useAppStore.subscribe((state, prev) => {
      if (state.draftReply === prev.draftReply) return;
      if (state.draftReply === lastFlushedDraftRef.current) return;
      lastFlushedDraftRef.current = state.draftReply;
      applyDraftToDom(state.draftReply);
    });
  }, []);

  useEffect(() => {
    setAttachmentOpen(false);
    setEmojiOpen(false);
    setMentionOpen(false);
    setMentionQuery("");
    trackedMentionsRef.current = [];
    if (mentionTrackerRef) mentionTrackerRef.current = [];
    setTranslateOriginal(null);
    resetVoiceInput();
    setDragOver(false);
    // 每个会话读取自己的草稿，避免未发送内容串到其它联系人。
    const state = useAppStore.getState();
    const d =
      draftReplyProp !== undefined
        ? draftReplyProp
        : getChatDraftValue(state.draftReplyByChatId, resetKey);
    lastFlushedDraftRef.current = d;
    applyDraftToDom(d);
    if (state.draftReply !== d) state.setDraftReply(d);
    if (mentionTimerRef.current != null) {
      window.clearTimeout(mentionTimerRef.current);
      mentionTimerRef.current = null;
    }
    const focusFrame = requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(focusFrame);
      if (resetKey) {
        useAppStore.getState().setChatDraft(resetKey, readDraft());
      }
    };
  }, [resetKey]);


  useEffect(() => {
    setTranslateLang(
      resolveTargetLang(activeContact, fullSettings(), lastInboundBody)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅目标语言/联系人/最近入站消息变时重算
  }, [activeContact, settingsUi.translateTargetLang, settingsProp, lastInboundBody]);

  useEffect(() => {
    if (!hasDraft) setTranslateOriginal(null);
  }, [hasDraft]);

  useEffect(() => {
    if (!recording) return;
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      void onEndVoice(false);
    };
    window.addEventListener("keydown", cancelOnEscape);
    return () => window.removeEventListener("keydown", cancelOnEscape);
  }, [recording, onEndVoice]);

  useEffect(
    () => () => {
      if (mentionTimerRef.current != null) {
        window.clearTimeout(mentionTimerRef.current);
      }
      if (resizeTimerRef.current != null) {
        window.clearTimeout(resizeTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!emojiOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!emojiPanelRef.current?.contains(event.target as Node)) {
        setEmojiOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [emojiOpen]);

  useEffect(() => {
    if (!voiceLanguageOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!voiceLanguageRef.current?.contains(event.target as Node)) {
        setVoiceLanguageOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [voiceLanguageOpen]);

  const handleTranslateDraft = async () => {
    const src = readDraft().trim();
    if (!src || translating || recording) return;
    setTranslating(true);
    try {
      const base = translateOriginal ?? src;
      if (!translateOriginal) setTranslateOriginal(base);
      const res = await translateDraftText(base, translateLang, fullSettings());
      if (!res.text?.trim()) {
        pushToast(res.error || t("runtime.translateFailed"), "error");
        if (!translateOriginal) setTranslateOriginal(null);
        return;
      }
      const next = res.text.trim();
      setDraftLocal(next);
      flushDraftNow(next);
      if (res.fallback && res.error) {
        pushToast(`已译（演示/回退）：${res.error.slice(0, 60)}`, "info");
      } else if (res.source === "mock") {
        pushToast(
          `已译成 ${langShortLabel(res.targetLang)}（演示模式，设置里可接 API）`,
          "success"
        );
      } else {
        pushToast(`已译成 ${langShortLabel(res.targetLang)}`, "success");
      }
    } catch (e) {
      pushToast(e instanceof Error ? e.message : t("runtime.translateFailed"), "error");
    } finally {
      setTranslating(false);
    }
  };

  const restoreTranslateOriginal = () => {
    if (translateOriginal == null) return;
    setDraftLocal(translateOriginal);
    flushDraftNow(translateOriginal);
    setTranslateOriginal(null);
    pushToast(t("runtime.restoredOriginal"), "info");
  };

  const mentionCandidates: MentionCandidate[] = useMemo(
    () => [
      { jid: "", label: "所有人", everyone: true },
      ...((groupMembers || []).map((m) => ({
        jid: m.jid,
        label: m.label || m.phoneE164 || m.jid,
        phoneE164: m.phoneE164,
      })) as MentionCandidate[]),
    ],
    [groupMembers]
  );
  const mentionItems = useMemo(
    () => filterMentionCandidates(mentionCandidates, mentionQuery),
    [mentionCandidates, mentionQuery]
  );

  const syncMentionState = (text: string, cursor: number) => {
    if (!activeContact?.isGroup && !(groupMembers && groupMembers.length)) {
      setMentionOpen((o) => (o ? false : o));
      return;
    }
    const hit = mentionQueryAt(text, cursor);
    if (!hit) {
      setMentionOpen((o) => (o ? false : o));
      return;
    }
    setMentionQuery((q) => (q === hit.query ? q : hit.query));
    setMentionOpen((o) => (o ? o : true));
    setMentionIdx(0);
  };

  const pickMention = (item: MentionCandidate) => {
    const el = textareaRef.current;
    const draft = readDraft();
    const cursor =
      el && typeof el.selectionStart === "number"
        ? el.selectionStart
        : draft.length;
    const res = applyMentionInsert(draft, cursor, item);
    setDraftLocal(res.text);
    flushDraftNow(res.text);
    const token = item.everyone
      ? "@所有人"
      : `@${(item.label || "成员").replace(/\s+/g, "")}`;
    const entry = {
      token,
      jid: item.jid,
      everyone: Boolean(item.everyone),
    };
    trackedMentionsRef.current = [...trackedMentionsRef.current, entry];
    if (mentionTrackerRef) {
      mentionTrackerRef.current = [...trackedMentionsRef.current];
    }
    setMentionOpen(false);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(res.cursor, res.cursor);
    });
    emitComposing();
  };

  const applyComposerBold = () => {
    const el = textareaRef.current;
    if (!el || inputLocked || recording || translating) return;
    const result = toggleComposerBold(
      el.value,
      el.selectionStart ?? el.value.length,
      el.selectionEnd ?? el.value.length
    );
    setDraftLocal(result.value);
    flushDraftNow(result.value);
    setTranslateOriginal(null);
    requestAnimationFrame(() => {
      const current = textareaRef.current;
      if (!current) return;
      current.focus({ preventScroll: true });
      current.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
    emitComposing();
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "chat-composer relative border-t border-zinc-800/90 p-3",
        dragOver && "bg-brand/5"
      )}
      onDragOver={(event) => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => {
        event.preventDefault();
        const files = Array.from(event.dataTransfer?.files || []);
        if (files.length) stageMedia(files);
      }}
    >
      {dragOver && (
        <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-lg border border-dashed border-brand/50 bg-zinc-950/80 text-[12px] text-brand">
          松开以发送图片 / 文件
        </div>
      )}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          // Copy the FileList before clearing the input. In WebView2/Tauri the
          // live FileList can be emptied by `value = ""`, which made the
          // picker appear to do nothing (especially for audio files).
          const files = Array.from(e.target.files || []);
          e.target.value = "";
          stageMedia(files);
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          // FileList is live in some WebViews; copy it before resetting the
          // input so selecting a file reliably reaches the preview pipeline.
          const files = Array.from(e.target.files || []);
          e.target.value = "";
          stageMedia(files, "file");
        }}
      />
      <input
        ref={stickerInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) stageMedia([f], "sticker");
        }}
      />
      <input
        ref={gifInputRef}
        type="file"
        accept="image/gif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) stageMedia([f], "gif");
        }}
      />
      {pendingMedia.length > 0 && (
        <MediaSendPreview
          items={pendingMedia}
          sendingIndex={mediaSendingIndex}
          onRemove={removeMedia}
          onClose={closeMediaPreview}
        />
      )}
      {recording && (
        <VoiceRecordingControls
          seconds={recordSec}
          paused={voicePaused}
          sending={sending}
          readLevel={readVoiceLevel}
          onDelete={() => void onEndVoice(false)}
          onTogglePause={onToggleVoicePause}
          onSend={() => void onEndVoice(true)}
        />
      )}
      {editingId && !recording && (
        <div className="mb-2 flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[12px] text-amber-100">
          <span>{t("composer.editing")}</span>
          <button
            type="button"
            className="text-2xs underline"
            onClick={() => {
              setEditingId(null);
              setDraftLocal("");
              flushDraftNow("");
            }}
          >
            {t("composer.cancel")}
          </button>
        </div>
      )}
      {replyTo && !recording && !editingId && (
        <div className="mb-2 flex items-start gap-2 rounded-lg border border-brand/25 bg-brand/5 px-2.5 py-1.5">
          <Reply className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
          <div className="min-w-0 flex-1">
            <div className="text-2xs font-medium text-brand">
              {replyTo.direction === "out" ? t("composer.replySelf") : t("composer.replyOther")}{t("composer.quoteSuffix")}
            </div>
            <div className="truncate text-[11px] text-zinc-400">
              {replyTo.body}
            </div>
          </div>
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            title={t("tooltip.cancelQuote")}
            onClick={() => setReplyTo(null)}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {!recording && <div
        className={cn(
          "composer-editor flex flex-col rounded-2xl border bg-zinc-900/90 shadow-sm shadow-black/20 transition-all duration-150 focus-within:border-brand/60 focus-within:ring-2 focus-within:ring-brand/15",
          dragOver
            ? "border-brand ring-2 ring-brand/20"
            : "border-zinc-700/80"
        )}
      >
        <div className="flex items-end gap-0.5 px-1.5 py-1.5">
          <div className="flex shrink-0 items-center gap-0.5 pb-0.5">
            <div className="relative">
              <button
                type="button"
                title={t("tooltip.addAttachment")}
                aria-expanded={attachmentOpen}
                disabled={sending || recording}
                onClick={() => {
                  setAttachmentOpen((v) => !v);
                  setEmojiOpen(false);
                }}
                className={cn(
                  "inline-flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100",
                  attachmentOpen && "bg-zinc-800 text-brand",
                  (sending || recording) &&
                    "cursor-not-allowed opacity-40"
                )}
              >
                <Plus className="h-4 w-4" />
              </button>
              {attachmentOpen && (
                <div className="absolute bottom-11 left-0 z-30 max-h-80 w-44 overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-1.5 shadow-xl shadow-black/40">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-zinc-200 hover:bg-zinc-800"
                    onClick={() => {
                      setAttachmentOpen(false);
                      imageInputRef.current?.click();
                    }}
                  >
                    <Image className="h-4 w-4 text-sky-400" />
                    {t("composer.image")}
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-zinc-200 hover:bg-zinc-800"
                    onClick={() => {
                      setAttachmentOpen(false);
                      fileInputRef.current?.click();
                    }}
                  >
                    <Paperclip className="h-4 w-4 text-violet-400" />
                    {t("composer.file")}
                  </button>
                  <button
                    type="button"
                    disabled={!isBaileys || !baileysConnected}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
                    onClick={() => {
                      setAttachmentOpen(false);
                      onOpenCatalog();
                    }}
                  >
                    <ShoppingBag className="h-4 w-4 text-emerald-400" />
                    {t("composer.product")}
                  </button>
                  <button
                    type="button"
                    disabled={!isBaileys || !baileysConnected}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
                    onClick={() => {
                      setAttachmentOpen(false);
                      onOpenContactPicker();
                    }}
                  >
                    <ContactRound className="h-4 w-4 text-amber-400" />
                    {t("composer.contact")}
                  </button>
                </div>
              )}
            </div>
            <div>
              <button
                type="button"
                title={t("tooltip.quickReplies")}
                aria-expanded={
                  !crmPanelCollapsed && crmPanelTab === "quick-replies"
                }
                aria-controls="crm-workspace-panel"
                disabled={recording}
                onClick={() => {
                  const state = useAppStore.getState();
                  const quickRepliesOpen =
                    !state.crmPanelCollapsed &&
                    state.crmPanelTab === "quick-replies";
                  useAppStore.setState({
                    crmPanelCollapsed: quickRepliesOpen,
                    crmPanelTab: quickRepliesOpen
                      ? "customer"
                      : "quick-replies",
                  });
                  setAttachmentOpen(false);
                  setEmojiOpen(false);
                }}
                className={cn(
                  "inline-flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100",
                  !crmPanelCollapsed &&
                    crmPanelTab === "quick-replies" &&
                    "bg-zinc-800 text-brand",
                  recording && "cursor-not-allowed opacity-40"
                )}
              >
                <Zap className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="relative min-w-0 flex-1">
            <MentionPicker
              open={mentionOpen}
              items={mentionItems}
              activeIndex={mentionIdx}
              onHover={setMentionIdx}
              onPick={pickMention}
            />
            <Textarea
              ref={textareaRef as never}
              data-composer-input="true"
              defaultValue={initialDraft}
              onChange={(e) => {
                if (inputLocked) return;
                markComposerInput();
                const startedAt = TYPING_DEBUG_ENABLED ? performance.now() : 0;
                const v = e.target.value;
                traceInputLatency(e.timeStamp, v.length);
                draftRef.current = v;
                if (pendingMedia.length > 0) setMediaCaption(v);
                scheduleTextareaResize();
                updateHasDraft(v);
                if (translateOriginal != null) setTranslateOriginal(null);
                if (
                  !composingRef.current &&
                  (activeContact?.isGroup ||
                    (groupMembers && groupMembers.length)) &&
                  v.includes("@")
                ) {
                  const cur = e.target.selectionStart ?? v.length;
                  if (mentionTimerRef.current != null) {
                    window.clearTimeout(mentionTimerRef.current);
                  }
                  mentionTimerRef.current = window.setTimeout(() => {
                    syncMentionState(v, cur);
                  }, 32);
                } else if (!composingRef.current && mentionOpen) {
                  setMentionOpen(false);
                }
                if (!composingRef.current) scheduleComposing();
                if (startedAt) {
                  const durationMs = performance.now() - startedAt;
                  if (durationMs >= 8) {
                    syncLog(
                      "typing",
                      "input handler slow",
                      {
                        durationMs: Math.round(durationMs),
                        draftLength: v.length,
                        mentionOpen,
                      },
                      durationMs >= 16 ? "warn" : "debug"
                    );
                  }
                }
              }}
              onCompositionStart={() => {
                composingRef.current = true;
                // 组合输入期间 input 事件可能稀疏，用开始/结束也刷新“正在输入”时钟，
                // 避免停顿超 quiet 窗口被当成没打字、后台同步趁机冲进来卡住后续按键。
                markComposerInput();
              }}
              onCompositionEnd={(e) => {
                composingRef.current = false;
                markComposerInput();
                const v = e.currentTarget.value;
                if (
                  (activeContact?.isGroup ||
                    (groupMembers && groupMembers.length)) &&
                  v.includes("@")
                ) {
                  syncMentionState(
                    v,
                    e.currentTarget.selectionStart ?? v.length
                  );
                }
                scheduleComposing();
              }}
              onSelect={(e) => {
                if (
                  !activeContact?.isGroup &&
                  !(groupMembers && groupMembers.length)
                )
                  return;
                const el = e.currentTarget;
                const v = el.value;
                if (!v.includes("@")) return;
                syncMentionState(v, el.selectionStart ?? v.length);
              }}
              onClick={(e) => {
                if (
                  !activeContact?.isGroup &&
                  !(groupMembers && groupMembers.length)
                )
                  return;
                const el = e.currentTarget;
                const v = el.value;
                if (!v.includes("@")) return;
                syncMentionState(v, el.selectionStart ?? v.length);
              }}
              onPaste={handleComposerPaste}
              onBlur={() => flushDraftNow(readDraft())}
              onFocus={() => markComposerInput()}
              onPointerDown={() => markComposerInput()}
              onKeyDown={(e) => {
                markComposerInput();
                if (
                  (e.ctrlKey || e.metaKey) &&
                  !e.altKey &&
                  e.key.toLowerCase() === "b"
                ) {
                  e.preventDefault();
                  applyComposerBold();
                  return;
                }
                if (mentionOpen && mentionItems.length) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setMentionIdx((i) => (i + 1) % mentionItems.length);
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setMentionIdx(
                      (i) => (i - 1 + mentionItems.length) % mentionItems.length
                    );
                    return;
                  }
                  if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    pickMention(
                      mentionItems[
                        Math.max(
                          0,
                          Math.min(mentionIdx, mentionItems.length - 1)
                        )
                      ]
                    );
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setMentionOpen(false);
                    return;
                  }
                }
                if (
                  e.key === "ArrowUp" &&
                  !e.altKey &&
                  !e.ctrlKey &&
                  !e.metaKey &&
                  !e.shiftKey &&
                  !composingRef.current &&
                  !readDraft().trim() &&
                  onEditLatest?.()
                ) {
                  e.preventDefault();
                  return;
                }
                if (e.key === "Escape" && recording) {
                  e.preventDefault();
                  void onEndVoice(false);
                  return;
                }
                if (e.key === "Escape" && editingId) {
                  setEditingId(null);
                  setDraftLocal("");
                  flushDraftNow("");
                  return;
                }
                if (e.key === "Escape" && pendingMedia.length > 0) {
                  closeMediaPreview();
                  return;
                }
                if (e.key === "Escape" && attachmentOpen) {
                  setAttachmentOpen(false);
                  return;
                }
                if (e.key === "Escape" && emojiOpen) {
                  setEmojiOpen(false);
                  return;
                }
                if (
                  (e.ctrlKey || e.metaKey) &&
                  e.shiftKey &&
                  e.key.toLowerCase() === "t"
                ) {
                  e.preventDefault();
                  void handleTranslateDraft();
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (inputLocked) return;
                  flushDraftNow(readDraft());
                  if (pendingMedia.length > 0) void sendPendingMedia();
                  else void onSend();
                }
              }}
              rows={1}
              autoComplete="off"
              spellCheck={false}
              placeholder={
                inputLocked
                  ? t("composer.preparing")
                  : recording
                    ? t("composer.releaseVoice")
                    : editingId
                      ? t("composer.editHint")
                      : activeContact?.isGroup
                        ? t("composer.groupPlaceholder")
                        : t("composer.placeholder")
              }
              disabled={inputLocked || recording || translating}
              className="!min-h-9 max-h-36 w-full resize-none overflow-y-auto border-0 bg-transparent px-2 py-2 text-[13px] shadow-none outline-none ring-0 focus:border-0 focus:outline-none focus:ring-0 focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>

          <div className="flex shrink-0 items-center gap-1 pb-0.5">
            <div ref={emojiPanelRef} className="relative">
              <button
                type="button"
                title={t("tooltip.emoji")}
                aria-expanded={emojiOpen}
                disabled={recording}
                onClick={() => {
                  setEmojiOpen((v) => !v);
                  setAttachmentOpen(false);
                }}
                className={cn(
                  "inline-flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100",
                  emojiOpen && "bg-zinc-800 text-brand",
                  recording && "cursor-not-allowed opacity-40"
                )}
              >
                <Smile className="h-4 w-4" />
              </button>
              {emojiOpen && (
                <Suspense
                  fallback={
                    <div className="absolute bottom-11 right-0 z-40 flex h-80 w-[22rem] items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900 text-[12px] text-zinc-500 shadow-xl shadow-black/40">
                      {t("reaction.loading")}
                    </div>
                  }
                >
                  <EmojiStickerGifPanel
                    open={emojiOpen}
                    isBaileys={isBaileys}
                    onPickEmoji={(emoji) => {
                      const next = `${readDraft()}${emoji}`;
                      setDraftLocal(next);
                      flushDraftNow(next);
                      setTranslateOriginal(null);
                      emitComposing();
                    }}
                    onPickStickerFile={() => stickerInputRef.current?.click()}
                    onPickGifFile={() => gifInputRef.current?.click()}
                    favoriteStickers={favoriteStickers}
                    recentStickers={recentStickers}
                    onSendFavoriteSticker={(dataUrl) => {
                      setEmojiOpen(false);
                      void onSendRecentSticker(dataUrl);
                    }}
                    onRemoveFavoriteSticker={onRemoveFavoriteSticker}
                    onSendRecentSticker={(dataUrl) => {
                      setEmojiOpen(false);
                      void onSendRecentSticker(dataUrl);
                    }}
                  />
                </Suspense>
              )}
            </div>
            <SendVoiceToggle
              hasDraft={hasDraft || pendingMedia.length > 0}
              sending={sending || mediaSendingIndex >= 0}
              disabled={inputLocked}
              isBaileys={isBaileys}
              onSend={() => {
                if (inputLocked) return;
                flushDraftNow(readDraft());
                if (pendingMedia.length > 0) void sendPendingMedia();
                else void onSend();
              }}
              onBeginVoice={() => void onBeginVoice()}
            />
            <div ref={voiceLanguageRef} className="relative">
              <button
                type="button"
                title={voiceInputOpen ? t("voice.statusListening") : t("tooltip.speechToText")}
                aria-label={t("tooltip.speechToText")}
                disabled={recording || sending || inputLocked}
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (voiceInputOpen || voiceInputBusy) return;
                  setVoiceLanguageOpen((open) => !open);
                }}
                onClick={() => {
                  setVoiceLanguageOpen(false);
                  if (voiceInputOpen) handleCancelVoiceInput();
                  else void handleToggleVoiceInput();
                }}
                className={cn(
                  "relative inline-flex h-9 w-9 items-center justify-center rounded-xl transition-colors",
                  voiceInputOpen
                    ? "bg-brand/15 text-brand ring-1 ring-brand/30"
                    : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100",
                  (recording || sending || inputLocked) &&
                    "cursor-not-allowed opacity-40"
                )}
              >
                {voiceInputBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Captions className="h-4 w-4" />
                )}
                <span className="absolute -bottom-0.5 -right-0.5 rounded bg-zinc-800 px-0.5 text-[7px] font-semibold leading-3 text-brand ring-1 ring-zinc-950">
                  {VOICE_INPUT_LANGUAGES.find(
                    (language) => language.value === settings.voiceInputLang
                  )?.short || "AUTO"}
                </span>
              </button>
              {voiceLanguageOpen && (
                <div className="absolute bottom-11 right-0 z-50 w-44 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 p-1 shadow-xl shadow-black/50">
                  <div className="px-2 py-1 text-[10px] text-zinc-500">
                    选择语音识别语言
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {VOICE_INPUT_LANGUAGES.map((language) => {
                      const selected =
                        language.value === (settings.voiceInputLang || "");
                      return (
                        <button
                          key={language.value || "auto"}
                          type="button"
                          onClick={() => {
                            useAppStore.getState().updateSettings({
                              voiceInputLang: language.value,
                            });
                            setVoiceLanguageOpen(false);
                          }}
                          className={cn(
                            "flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[11px] hover:bg-zinc-800",
                            selected ? "text-brand" : "text-zinc-300"
                          )}
                        >
                          <span>{language.label}</span>
                          <span className="text-[9px] text-zinc-500">
                            {language.short}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <TranslateBar
          visible={
            (hasDraft || translateOriginal != null) &&
            !recording &&
            !editingId
          }
          hasDraft={hasDraft}
          translateOriginal={translateOriginal}
          translating={translating}
          translateLang={translateLang}
          detected={!activeContact?.preferredLang}
          onTranslateLangChange={(lang) => {
            setTranslateLang(lang);
            if (activeContact) {
              updateContact(activeContact.id, {
                preferredLang: lang,
              });
            }
          }}
          onTranslate={() => void handleTranslateDraft()}
          onRestore={restoreTranslateOriginal}
          recording={recording}
          recordSec={recordSec}
        />
        {voiceInputOpen && (
          <div className="order-first flex items-center gap-2 border-b border-zinc-800/90 bg-zinc-950/40 px-3 py-1.5">
            <Loader2 className="h-3 w-3 shrink-0 animate-spin text-brand" />
            <span className="text-[11px] text-zinc-300">
              正在听…（{voiceInputEngineLabel}）边说边转，点击麦克风按钮取消
            </span>
          </div>
        )}
      </div>}
    </div>
  );
}

export const Composer = memo(ComposerInner);
Composer.displayName = "Composer";
