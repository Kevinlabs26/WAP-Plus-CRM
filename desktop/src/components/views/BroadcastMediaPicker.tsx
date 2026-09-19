import { useRef, useState } from "react";
import { FileImage, FileAudio, FileVideo, FileText, Plus, X } from "lucide-react";
import type {
  BroadcastMedia,
  BroadcastMediaKind,
  BroadcastMediaMode,
} from "@/types/broadcast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/primitives";
import { useI18n, type TranslationKey } from "@/i18n";

type PendingMedia = BroadcastMedia & {
  dataUrl: string;
  size: number;
};

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

function kindOf(file: File): BroadcastMediaKind {
  const t = file.type || "";
  if (t.startsWith("image/")) return "image";
  if (t.startsWith("video/")) return "video";
  if (t.startsWith("audio/")) return "audio";
  return "document";
}

const KIND_ICON: Record<BroadcastMediaKind, typeof FileImage> = {
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  document: FileText,
};

const KIND_LABEL_KEY: Record<BroadcastMediaKind, TranslationKey> = {
  image: "broadcast.mediaImage",
  video: "broadcast.mediaVideo",
  audio: "broadcast.mediaAudio",
  document: "broadcast.mediaDocument",
};

/**
 * 群发媒体选择器：多选图片/视频/音频/文件，预览 + 分配模式。
 * 文件只存内存（dataUrl 供预览）；启动战役时才写入 IDB。
 */
export function BroadcastMediaPicker(props: {
  media: BroadcastMedia[];
  mediaMode: BroadcastMediaMode;
  onChange: (
    media: BroadcastMedia[],
    mode: BroadcastMediaMode,
    dataUrls: Record<string, string>
  ) => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState<PendingMedia[]>([]);
  const [busy, setBusy] = useState(false);

  const commit = (items: PendingMedia[], mode: BroadcastMediaMode) => {
    setPending(items);
    const dataUrls: Record<string, string> = {};
    for (const item of items) dataUrls[item.id] = item.dataUrl;
    props.onChange(
      items.map(({ id, kind, mime, fileName }) => ({ id, kind, mime, fileName })),
      mode,
      dataUrls
    );
  };

  const addFiles = async (files: FileList | File[] | null | undefined) => {
    if (!files || !files.length) return;
    setBusy(true);
    try {
      const next: PendingMedia[] = [];
      for (const file of Array.from(files).slice(0, 10)) {
        const id = `broadcast-media-${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        next.push({
          id,
          kind: kindOf(file),
          mime: file.type || "application/octet-stream",
          fileName: file.name || undefined,
          dataUrl: await fileToDataUrl(file),
          size: file.size,
        });
      }
      commit([...pending, ...next].slice(0, 10), props.mediaMode);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = (id: string) => {
    commit(
      pending.filter((item) => item.id !== id),
      props.mediaMode
    );
  };

  const setMode = (mode: BroadcastMediaMode) => {
    commit(pending, mode);
  };

  const showMode = pending.length > 1;
  const total = pending.reduce((sum, item) => sum + item.size, 0);

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          className="!min-h-8 gap-1 !px-2.5 text-2xs"
          disabled={busy || pending.length >= 10}
          onClick={() => inputRef.current?.click()}
        >
          <Plus className="h-3.5 w-3.5" />
          {pending.length ? t("broadcast.addMoreMedia") : t("broadcast.addMedia")}
        </Button>
        {pending.length > 0 && (
          <span className="text-2xs text-zinc-500">
            {t("broadcast.mediaCount", { count: pending.length })} ·{" "}
            {total > 1024 * 1024
              ? `${(total / 1024 / 1024).toFixed(1)} MB`
              : `${Math.max(1, Math.round(total / 1024))} KB`}
          </span>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"
        className="hidden"
        onChange={(event) => void addFiles(event.target.files)}
      />

      {pending.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {pending.map((item) => {
            const Icon = KIND_ICON[item.kind];
            return (
              <div
                key={item.id}
                className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-2 py-1.5"
              >
                {item.kind === "image" && item.dataUrl ? (
                  <img
                    src={item.dataUrl}
                    alt=""
                    className="h-9 w-9 shrink-0 rounded object-cover"
                  />
                ) : (
                  <Icon className="h-4 w-4 shrink-0 text-zinc-400" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-2xs text-zinc-200">
                    {item.fileName || t("broadcast.unnamedFile")}
                  </div>
                  <div className="text-2xs text-zinc-500">
                    {t(KIND_LABEL_KEY[item.kind])} ·{" "}
                    {item.size > 1024 * 1024
                      ? `${(item.size / 1024 / 1024).toFixed(1)} MB`
                      : `${Math.max(1, Math.round(item.size / 1024))} KB`}
                  </div>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                  onClick={() => remove(item.id)}
                  title={t("broadcast.removeMedia")}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}

          {showMode && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {(
                [
                  ["single", t("broadcast.mediaModeSingle")],
                  ["random", t("broadcast.mediaModeRandom")],
                  ["roundrobin", t("broadcast.mediaModeRoundRobin")],
                ] as [BroadcastMediaMode, string][]
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setMode(mode)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-2xs transition-colors",
                    props.mediaMode === mode
                      ? "border-brand/50 bg-brand/10 text-brand"
                      : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
                  )}
                >
                  {label}
                </button>
              ))}
              <span className="pl-1 text-2xs text-zinc-600">
                {t("broadcast.mediaModeRandomHint", { count: pending.length })}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
