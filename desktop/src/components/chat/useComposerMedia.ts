import { useEffect, useRef, useState } from "react";
import type { ClipboardEvent } from "react";
import type {
  PendingMediaItem,
  PendingMediaKind,
} from "./MediaSendPreview";

type UseComposerMediaOptions = {
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

/**
 * 附件/媒体暂存 + 发送：独立管理 pendingMedia 列表、预览 URL 生命周期与发送进度，
 * 从 Composer 抽离以缩小组件体积。
 */
export function useComposerMedia(opts: UseComposerMediaOptions) {
  const {
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
  const [pendingMedia, setPendingMedia] = useState<PendingMediaItem[]>([]);
  const [mediaCaption, setMediaCaption] = useState("");
  const [mediaSendingIndex, setMediaSendingIndex] = useState(-1);
  const pendingMediaRef = useRef<PendingMediaItem[]>([]);

  const isAudioFile = (file: File) => {
    if (file.type.toLowerCase().startsWith("audio/")) return true;
    return /\.(m4a|aac|mp3|wav|flac|ogg|oga|opus|webm)$/i.test(file.name);
  };

  useEffect(() => {
    pendingMediaRef.current = pendingMedia;
  }, [pendingMedia]);

  useEffect(
    () => () => {
      pendingMediaRef.current.forEach(
        (item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl)
      );
    },
    []
  );

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
    setPendingMedia((current) => [...current, ...accepted]);
    if (!pendingMediaRef.current.length) setMediaCaption(readDraft());
    onStageMedia?.();
  };

  const closeMediaPreview = () => {
    setPendingMedia((items) => {
      items.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl));
      return [];
    });
    setMediaCaption("");
    setMediaSendingIndex(-1);
  };

  const removeMedia = (id: string) => {
    setPendingMedia((items) => {
      const removed = items.find((item) => item.id === id);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return items.filter((item) => item.id !== id);
    });
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
    pendingMedia.forEach(
      (item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl)
    );
    setPendingMedia([]);
    setMediaSendingIndex(-1);
    setMediaCaption("");
    if (sent.size && mediaCaption.trim()) {
      setDraftLocal("");
      flushDraftNow("");
    }
  };

  /** 切换会话时重置 */
  const resetMedia = () => {
    setPendingMedia((items) => {
      items.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl));
      return [];
    });
    setMediaCaption("");
    setMediaSendingIndex(-1);
  };

  return {
    pendingMedia,
    mediaCaption,
    setMediaCaption,
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
