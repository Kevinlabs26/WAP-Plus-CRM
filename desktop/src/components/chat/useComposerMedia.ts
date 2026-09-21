import { useEffect, useRef, useState } from "react";
import type { ClipboardEvent } from "react";
import { idbDel, idbGet, idbSet } from "@/lib/idb";
import type {
  PendingMediaItem,
  PendingMediaKind,
} from "./MediaSendPreview";

type UseComposerMediaOptions = {
  chatKey: string;
  readDraft: () => string;
  setDraftLocal: (text: string) => void;
  flushDraftNow: (text: string) => void;
  onSendImage: (file: File, caption?: string) => boolean | Promise<boolean>;
  onSendAudio: (file: File, caption?: string) => boolean | Promise<boolean>;
  onSendSticker: (file: File) => boolean | Promise<boolean>;
  onSendGif: (file: File, caption?: string) => boolean | Promise<boolean>;
  onSendFile: (file: File, caption?: string) => boolean | Promise<boolean>;
  /** 加入附件后需要收起的弹层（附件菜单/表情面板等） */
  onStageMedia?: () => void;
};

// Composer may be remounted when the chat pane changes mode. Keep staged File
// objects at module scope so a remount in the same app session does not lose
// attachments before the user presses send.
const savedMediaByChat = new Map<
  string,
  { items: PendingMediaItem[]; caption: string }
>();
const MAX_SAVED_MEDIA_CHATS = 20;
const PENDING_MEDIA_KEY_PREFIX = "composer-media:";
const MAX_PERSISTED_MEDIA_BYTES = 128 * 1024 * 1024;

type PersistedMediaDraft = {
  caption: string;
  items: Array<{
    id: string;
    kind: PendingMediaKind;
    name: string;
    type: string;
    lastModified: number;
    blob: Blob;
  }>;
};

const pendingMediaKey = (chatKey: string) =>
  `${PENDING_MEDIA_KEY_PREFIX}${encodeURIComponent(chatKey)}`;

async function persistMediaDraft(
  chatKey: string,
  items: PendingMediaItem[],
  caption: string
) {
  if (!items.length && !caption) {
    await idbDel(pendingMediaKey(chatKey));
    return;
  }
  const totalBytes = items.reduce((sum, item) => sum + item.file.size, 0);
  if (totalBytes > MAX_PERSISTED_MEDIA_BYTES) {
    // Keep the live in-memory draft, but avoid turning a large attachment into
    // a hidden database copy that can unexpectedly exhaust local storage.
    await idbDel(pendingMediaKey(chatKey));
    return;
  }
  await idbSet(pendingMediaKey(chatKey), {
    caption,
    items: items.map((item) => ({
      id: item.id,
      kind: item.kind,
      name: item.file.name,
      type: item.file.type,
      lastModified: item.file.lastModified,
      blob: item.file,
    })),
  } satisfies PersistedMediaDraft);
}

async function loadMediaDraft(chatKey: string): Promise<{
  items: PendingMediaItem[];
  caption: string;
} | null> {
  try {
    const saved = await idbGet<PersistedMediaDraft>(pendingMediaKey(chatKey));
    if (!saved?.items?.length && !saved?.caption) return null;
    const items = (saved.items || []).flatMap((item) => {
      if (!item?.blob || !item.id || !item.name) return [];
      const file = new File([item.blob], item.name, {
        type: item.type || item.blob.type || "application/octet-stream",
        lastModified: item.lastModified || Date.now(),
      });
      return [{
        id: item.id,
        kind: item.kind,
        file,
        previewUrl: file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : undefined,
      } satisfies PendingMediaItem];
    });
    return { items, caption: saved.caption || "" };
  } catch {
    return null;
  }
}

function rememberSavedMedia(
  chatKey: string,
  items: PendingMediaItem[],
  caption: string
) {
  savedMediaByChat.delete(chatKey);
  savedMediaByChat.set(chatKey, { items, caption });
  while (savedMediaByChat.size > MAX_SAVED_MEDIA_CHATS) {
    const oldestKey = savedMediaByChat.keys().next().value as string | undefined;
    if (!oldestKey) break;
    const oldest = savedMediaByChat.get(oldestKey);
    oldest?.items.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl));
    savedMediaByChat.delete(oldestKey);
  }
}

/**
 * 附件/媒体暂存 + 发送：独立管理 pendingMedia 列表、预览 URL 生命周期与发送进度，
 * 从 Composer 抽离以缩小组件体积。
 */
export function useComposerMedia(opts: UseComposerMediaOptions) {
  const {
    chatKey,
    readDraft,
    setDraftLocal,
    flushDraftNow,
    onSendImage,
    onSendAudio,
    onSendSticker,
    onSendGif,
    onSendFile,
    onStageMedia,
  } = opts;
  const initialSaved = savedMediaByChat.get(chatKey);
  const [pendingMedia, setPendingMedia] = useState<PendingMediaItem[]>(
    () => initialSaved?.items || []
  );
  const [mediaCaption, setMediaCaption] = useState(
    () => initialSaved?.caption || ""
  );
  const [mediaSendingIndex, setMediaSendingIndex] = useState(-1);
  const pendingMediaRef = useRef<PendingMediaItem[]>([]);
  const mediaCaptionRef = useRef("");
  const activeChatKeyRef = useRef(chatKey);
  const persistTimersRef = useRef(
    new Map<string, ReturnType<typeof setTimeout>>()
  );

  const isAudioFile = (file: File) => {
    if (file.type.toLowerCase().startsWith("audio/")) return true;
    return /\.(m4a|aac|mp3|wav|flac|ogg|oga|opus|webm)$/i.test(file.name);
  };

  useEffect(() => {
    pendingMediaRef.current = pendingMedia;
  }, [pendingMedia]);

  useEffect(() => {
    mediaCaptionRef.current = mediaCaption;
  }, [mediaCaption]);

  const schedulePersist = (
    key: string,
    items: PendingMediaItem[],
    caption: string
  ) => {
    const previous = persistTimersRef.current.get(key);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      persistTimersRef.current.delete(key);
      void persistMediaDraft(key, items, caption).catch(() => undefined);
    }, 250);
    persistTimersRef.current.set(key, timer);
  };

  const saveCurrentMedia = (
    items = pendingMediaRef.current,
    caption = mediaCaptionRef.current
  ) => {
    if (!activeChatKeyRef.current) return;
    if (items.length || caption) {
      rememberSavedMedia(activeChatKeyRef.current, items, caption);
      schedulePersist(activeChatKeyRef.current, items, caption);
    } else {
      savedMediaByChat.delete(activeChatKeyRef.current);
      schedulePersist(activeChatKeyRef.current, [], "");
    }
  };

  const updateMediaCaption = (value: string) => {
    mediaCaptionRef.current = value;
    setMediaCaption(value);
    saveCurrentMedia(pendingMediaRef.current, value);
  };

  useEffect(() => {
    let cancelled = false;
    if (!savedMediaByChat.has(chatKey)) {
      void loadMediaDraft(chatKey).then((restored) => {
        if (
          cancelled ||
          !restored ||
          activeChatKeyRef.current !== chatKey ||
          pendingMediaRef.current.length
        ) {
          restored?.items.forEach(
            (item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl)
          );
          return;
        }
        rememberSavedMedia(chatKey, restored.items, restored.caption);
        pendingMediaRef.current = restored.items;
        mediaCaptionRef.current = restored.caption;
        setPendingMedia(restored.items);
        setMediaCaption(restored.caption);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [chatKey]);

  useEffect(() => () => {
    void persistMediaDraft(
      activeChatKeyRef.current,
      pendingMediaRef.current,
      mediaCaptionRef.current
    ).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (activeChatKeyRef.current === chatKey) return;
    saveCurrentMedia();
    const next = savedMediaByChat.get(chatKey);
    activeChatKeyRef.current = chatKey;
    pendingMediaRef.current = next?.items || [];
    mediaCaptionRef.current = next?.caption || "";
    setPendingMedia(pendingMediaRef.current);
    setMediaCaption(mediaCaptionRef.current);
    setMediaSendingIndex(-1);
  }, [chatKey]);

  const stageMedia = (
    list: FileList | File[] | null | undefined,
    forcedKind?: PendingMediaKind
  ) => {
    if (!list) return;
    const files = Array.from(list).filter(Boolean).slice(0, 5);
    if (!files.length) return;
    const items = files.map((file): PendingMediaItem => {
      // The generic “文件” picker must still route audio through the audio
      // sender; otherwise an audio file is forced into the document path and
      // appears to do nothing in the voice/audio workflow.
      const kind =
        forcedKind === "file" && isAudioFile(file)
          ? "audio"
          : forcedKind ||
            (file.type === "image/gif"
              ? "gif"
              : isAudioFile(file)
                ? "audio"
                : file.type.startsWith("image/")
                  ? "image"
                  : "file");
      return {
        id: crypto.randomUUID(),
        file,
        kind,
        previewUrl: file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : undefined,
      };
    });
    const capacity = Math.max(0, 5 - pendingMediaRef.current.length);
    const accepted = items.slice(0, capacity);
    items
      .slice(capacity)
      .forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl));
    const nextItems = [...pendingMediaRef.current, ...accepted];
    pendingMediaRef.current = nextItems;
    const nextCaption = pendingMediaRef.current.length === accepted.length
      ? readDraft()
      : mediaCaptionRef.current;
    mediaCaptionRef.current = nextCaption;
    setPendingMedia(nextItems);
    setMediaCaption(nextCaption);
    saveCurrentMedia(nextItems, nextCaption);
    onStageMedia?.();
  };

  const closeMediaPreview = () => {
    pendingMediaRef.current.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl));
    pendingMediaRef.current = [];
    mediaCaptionRef.current = "";
    setPendingMedia([]);
    setMediaCaption("");
    saveCurrentMedia([], "");
    setMediaSendingIndex(-1);
  };

  const removeMedia = (id: string) => {
    const removed = pendingMediaRef.current.find((item) => item.id === id);
    if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
    const nextItems = pendingMediaRef.current.filter((item) => item.id !== id);
    pendingMediaRef.current = nextItems;
    setPendingMedia(nextItems);
    saveCurrentMedia(nextItems);
  };

  const handleComposerPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const cd = e.clipboardData;
    if (!cd) return;
    const fromFiles = cd.files?.length ? Array.from(cd.files) : [];
    const fromItems: File[] = [];
    for (const it of Array.from(cd.items || [])) {
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f) fromItems.push(f);
      }
    }
    const files = fromFiles.length ? fromFiles : fromItems;
    if (!files.length) return;
    e.preventDefault();
    stageMedia(files);
  };

  const sendPendingMedia = async () => {
    if (!pendingMedia.length || mediaSendingIndex >= 0) return;
    const sent = new Set<string>();
    let captionUsed = false;
    for (let index = 0; index < pendingMedia.length; index++) {
      const item = pendingMedia[index]!;
      setMediaSendingIndex(index);
      const caption =
        !captionUsed && item.kind !== "sticker" ? mediaCaption.trim() : "";
      const ok =
        item.kind === "image"
          ? await onSendImage(item.file, caption)
          : item.kind === "audio"
            ? await onSendAudio(item.file, caption)
          : item.kind === "sticker"
            ? await onSendSticker(item.file)
            : item.kind === "gif"
              ? await onSendGif(item.file, caption)
              : await onSendFile(item.file, caption);
      if (ok) {
        sent.add(item.id);
        if (caption) captionUsed = true;
      }
    }
    pendingMedia.forEach((item) => {
      if (sent.has(item.id) && item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
    const remaining = pendingMedia.filter((item) => !sent.has(item.id));
    pendingMediaRef.current = remaining;
    setPendingMedia(remaining);
    setMediaSendingIndex(-1);
    if (!remaining.length) {
      mediaCaptionRef.current = "";
      setMediaCaption("");
      saveCurrentMedia([], "");
    } else {
      saveCurrentMedia(remaining, mediaCaptionRef.current);
    }
    if (sent.size && mediaCaption.trim()) {
      setDraftLocal("");
      flushDraftNow("");
    }
  };

  /** 切换会话时重置 */
  const resetMedia = () => {
    pendingMediaRef.current.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl));
    pendingMediaRef.current = [];
    mediaCaptionRef.current = "";
    setPendingMedia([]);
    setMediaCaption("");
    saveCurrentMedia([], "");
    setMediaSendingIndex(-1);
  };

  return {
    pendingMedia,
    mediaCaption,
    setMediaCaption: updateMediaCaption,
    mediaSendingIndex,
    setMediaSendingIndex,
    stageMedia,
    removeMedia,
    closeMediaPreview,
    sendPendingMedia,
    handleComposerPaste,
    resetMedia,
  };
}
