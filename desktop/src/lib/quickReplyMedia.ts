export type QuickReplyMediaSelection = {
  dataUrl: string;
  fileName: string;
  mimeType: string;
  kind: "image" | "audio" | "video" | "file";
  caption?: string;
  token: string;
  target?: "main" | "multi";
};

const listeners = new Set<(selection: QuickReplyMediaSelection) => void>();

export function onQuickReplyMedia(
  listener: (selection: QuickReplyMediaSelection) => void
) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitQuickReplyMedia(selection: QuickReplyMediaSelection) {
  for (const listener of listeners) listener(selection);
}

export function quickReplyMediaToFile(selection: QuickReplyMediaSelection): File | null {
  const match = /^data:([^;,]+)?(?:;[^,]*)?,(.*)$/s.exec(selection.dataUrl || "");
  if (!match) return null;
  try {
    const payload = match[2] || "";
    const bytes = Uint8Array.from(atob(payload), (char) => char.charCodeAt(0));
    return new File([bytes], selection.fileName || "媒体", {
      type: selection.mimeType || match[1] || "application/octet-stream",
    });
  } catch {
    return null;
  }
}
