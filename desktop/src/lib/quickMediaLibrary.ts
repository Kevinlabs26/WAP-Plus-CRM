import { idbDel, idbDelPrefix, idbEntriesPrefix, idbGet, idbSet } from "./idb";

const META = "quick-media:meta:";
const CONTENT = "quick-media:content:";
export const QUICK_MEDIA_MAX_BYTES = 100 * 1024 * 1024;
export const QUICK_MEDIA_CHANGED = "wap:quick-media";

export type QuickMedia = {
  id: string;
  title: string;
  mime: string;
  kind: "audio" | "video";
  size?: number;
  duration?: number;
  thumbnail?: string;
  createdAt: number;
};

const mediaMimeByExtension: Record<string, string> = {
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm",
  mkv: "video/x-matroska", avi: "video/x-msvideo", "3gp": "video/3gpp",
  mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav",
  ogg: "audio/ogg", opus: "audio/ogg", flac: "audio/flac",
};

export function quickMediaFileType(file: Pick<File, "type" | "name">) {
  if (file.type && file.type !== "application/octet-stream") return file.type;
  return mediaMimeByExtension[file.name.toLowerCase().split(".").pop() || ""] || "";
}

export async function listQuickMedia() {
  const entries = await idbEntriesPrefix<QuickMedia>(META);
  return entries.map(([, item]) => item).sort((a, b) => b.createdAt - a.createdAt);
}

function previewMetadata(file: File, kind: QuickMedia["kind"]): Promise<Pick<QuickMedia, "duration" | "thumbnail">> {
  return new Promise(resolve => {
    const media = document.createElement(kind);
    const url = URL.createObjectURL(file);
    const finish = () => {
      clearTimeout(timer);
      const duration = Number.isFinite(media.duration) && media.duration > 0 ? media.duration : undefined;
      let thumbnail: string | undefined;
      if (media instanceof HTMLVideoElement && media.videoWidth && media.readyState >= 2) {
        try {
          const canvas = document.createElement("canvas");
          const scale = Math.min(1, 180 / Math.max(media.videoWidth, media.videoHeight));
          canvas.width = Math.max(1, Math.round(media.videoWidth * scale));
          canvas.height = Math.max(1, Math.round(media.videoHeight * scale));
          canvas.getContext("2d")?.drawImage(media, 0, 0, canvas.width, canvas.height);
          thumbnail = canvas.toDataURL("image/jpeg", 0.75);
        } catch { /* The original is still available for playback. */ }
      }
      media.onloadedmetadata = media.onloadeddata = media.onerror = null;
      media.removeAttribute("src");
      media.load();
      URL.revokeObjectURL(url);
      resolve({ duration, thumbnail });
    };
    const timer = setTimeout(finish, 3000);
    media.preload = kind === "video" ? "auto" : "metadata";
    media.muted = true;
    if (kind === "video") media.onloadeddata = finish;
    else media.onloadedmetadata = finish;
    media.onerror = finish;
    media.src = url;
  });
}

export async function addQuickMedia(file: File) {
  const mime = quickMediaFileType(file);
  const kind = mime.startsWith("audio/") ? "audio" : mime.startsWith("video/") ? "video" : null;
  if (!kind) throw Error("quickMedia.unsupportedFile");
  if (!file.size) throw Error("quickMedia.emptyFile");
  if (file.size > QUICK_MEDIA_MAX_BYTES) throw Error("quickMedia.fileTooLarge");
  if (file.type !== mime) file = new File([file], file.name, { type: mime, lastModified: file.lastModified });
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const id = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  if (await idbGet<QuickMedia>(META + id, true)) return false;
  const item: QuickMedia = { id, title: file.name, mime, kind, size: file.size, createdAt: Date.now(), ...await previewMetadata(file, kind) };
  await idbSet(META + id, item, [{ key: CONTENT + id, value: file }]);
  window.dispatchEvent(new Event(QUICK_MEDIA_CHANGED));
  return true;
}

export async function readQuickMedia(item: QuickMedia) {
  const blob = await idbGet<Blob>(CONTENT + item.id, true);
  if (!blob) throw Error("Media file unavailable");
  return new File([blob], item.title, { type: item.mime });
}

export async function removeQuickMedia(id: string) {
  await removeQuickMediaBatch([id]);
}

export async function removeQuickMediaBatch(ids: readonly string[]) {
  const unique = [...new Set(ids)];
  const [first, ...rest] = unique;
  if (!first) return;
  await idbDel(META + first, [...rest.map(id => META + id), ...unique.map(id => CONTENT + id)]);
  window.dispatchEvent(new Event(QUICK_MEDIA_CHANGED));
}

export async function clearQuickMedia() {
  await idbDelPrefix("quick-media:");
  window.dispatchEvent(new Event(QUICK_MEDIA_CHANGED));
}
