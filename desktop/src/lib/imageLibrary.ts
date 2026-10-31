import { invoke } from "@tauri-apps/api/core";
import { quickReplyMediaToFile } from "./quickReplyMedia";
import { downloadJson } from "./exportData";

export type LibraryImage = {
  id: string; title: string; category: string; mime: string; size: number;
  thumbnail: string; pinned: boolean; usedAt: number; createdAt: number;
};
export const IMAGE_LIMIT = 8 * 1024 * 1024;
const BACKUP_LIMIT = 128 * 1024 * 1024;
const mimeTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

async function command<T>(request: Record<string, unknown>): Promise<T> {
  return invoke<T>("image_library", { request });
}
function changed() { window.dispatchEvent(new Event("wap:image-library")); }
export const listLibraryImages = () => command<LibraryImage[]>({ action: "list" });
export const readLibraryImage = (id: string) => command<string>({ action: "read", id });
export async function editLibraryImage(image: Pick<LibraryImage, "id" | "title" | "category" | "pinned" | "usedAt">) {
  await command({ action: "edit", id: image.id, title: image.title, category: image.category, pinned: image.pinned, used_at: image.usedAt });
}
export async function deleteLibraryImages(ids: string[]) {
  await command({ action: "delete", ids });
}

export async function prepareLibraryImage(file: File) {
  if (!mimeTypes.has(file.type) || !file.size || file.size > IMAGE_LIMIT) throw new Error("PNG / JPEG / GIF / WebP · ≤ 8 MB");
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(file);
  });
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("Cannot decode image")); img.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error("Image dimensions exceed limit (40 MP)");
    const scale = Math.min(1, 240 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Cannot create thumbnail");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { data, thumbnail: canvas.toDataURL("image/jpeg", 0.7) };
  } finally { URL.revokeObjectURL(url); }
}

export async function addLibraryImage(file: File, category = "", title = file.name) {
  const prepared = await prepareLibraryImage(file);
  const result = await command<{ id: string; added: boolean }>({ action: "import", title: title.trim().slice(0, 160) || file.name.slice(0, 160), category: category.trim(), ...prepared });
  return result;
}

export async function saveChatImage(source: string, title: string) {
  let file: File | null;
  if (source.startsWith("blob:")) {
    const blob = await (await fetch(source)).blob(); file = new File([blob], title, { type: blob.type });
  } else {
    file = quickReplyMediaToFile({ dataUrl: source, fileName: title, mimeType: /^data:([^;,]+)/.exec(source)?.[1] || "", kind: "image", token: "library" });
  }
  if (!file) throw new Error("Download the image before saving it to the library");
  const result = await addLibraryImage(file); changed(); return result;
}

export function filterLibraryImages(images: LibraryImage[], query: string, category: string, view: "all" | "pinned" | "recent") {
  const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  return images.filter(item => (category === "*" || item.category === category) && (view !== "pinned" || item.pinned) && (view !== "recent" || item.usedAt > 0) && words.every(word => normalize(`${item.title} ${item.category}`).includes(word)))
    .sort((a, b) => view === "recent" ? b.usedAt - a.usedAt : Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt);
}

export async function exportImageLibrary(images: LibraryImage[]) {
  // Bound JSON memory; large libraries can be exported as several selections.
  if (images.reduce((sum, image) => sum + image.size * 4 / 3 + 1024, 0) > BACKUP_LIMIT) throw new Error("Backup exceeds 128 MB; select fewer images and export in batches");
  const items = [];
  for (const image of images) items.push({ title: image.title, category: image.category, pinned: image.pinned, usedAt: image.usedAt, data: await readLibraryImage(image.id) });
  downloadJson(`wap-image-library-${new Date().toISOString().slice(0, 10)}.json`, { app: "WAP Plus CRM Image Library", version: 1, items });
}

export function parseImageLibraryBackup(input: unknown): { title: string; category: string; data: string; pinned: boolean; usedAt: number }[] {
  const value = input as { app?: unknown; version?: unknown; items?: unknown } | null;
  if (!value || value.app !== "WAP Plus CRM Image Library" || value.version !== 1 || !Array.isArray(value.items) || value.items.length > 3000) throw new Error("Invalid image library backup");
  let total = 0;
  return value.items.map(item => {
    if (!item || typeof item.title !== "string" || !item.title.trim() || item.title.length > 160 || typeof item.category !== "string" || item.category.length > 60 || typeof item.data !== "string" || !/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(item.data) || item.data.length > IMAGE_LIMIT * 4 / 3 + 128) throw new Error("Invalid image in library backup");
    total += item.data.length; if (total > BACKUP_LIMIT) throw new Error("Backup exceeds 128 MB");
    return { title: item.title, category: item.category, data: item.data, pinned: item.pinned === true, usedAt: typeof item.usedAt === "number" && Number.isFinite(item.usedAt) && item.usedAt >= 0 && item.usedAt <= Date.now() ? item.usedAt : 0 };
  });
}

export async function restoreImageLibrary(file: File, onProgress: (done: number, total: number) => void) {
  if (file.size > BACKUP_LIMIT) throw new Error("Backup exceeds 128 MB");
  const items = parseImageLibraryBackup(JSON.parse(await file.text()));
  let added = 0;
  for (let index = 0; index < items.length; index++) {
    const item = items[index]!;
    const file = quickReplyMediaToFile({ dataUrl: item.data, fileName: item.title, mimeType: /^data:([^;,]+)/.exec(item.data)![1]!, kind: "image", token: "restore" });
    if (!file) throw new Error("Invalid image in library backup");
    const result = await addLibraryImage(file, item.category, item.title); added += Number(result.added);
    if (result.added) await editLibraryImage({ ...item, id: result.id });
    onProgress(index + 1, items.length);
  }
  return added;
}
