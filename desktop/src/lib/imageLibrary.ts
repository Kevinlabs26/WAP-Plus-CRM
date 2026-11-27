import { invoke } from "@tauri-apps/api/core";
import { quickReplyMediaToFile } from "./quickReplyMedia";
import { downloadJson } from "./exportData";

export type LibraryImage = {
  id: string; title: string; category: string; mime: string; size: number;
  thumbnail: string; pinned: boolean; usedAt: number; createdAt: number;
  caption?: string;
  sortOrder?:number;
};
export const IMAGE_LIMIT = 8 * 1024 * 1024;
const BACKUP_LIMIT = 128 * 1024 * 1024;
const mimeTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

async function command<T>(request: Record<string, unknown>): Promise<T> {
  return invoke<T>("image_library", { request });
}
function changed() { window.dispatchEvent(new Event("wap:image-library")); }
let pendingImages: { event?: Event; result: Promise<LibraryImage[]> } | undefined;
export function listLibraryImages(metadataOnly = false, event?: Event) {
  if (!metadataOnly) return command<LibraryImage[]>({ action: "list" });
  if (pendingImages && (!event || pendingImages.event === event)) return pendingImages.result;
  const result = command<LibraryImage[]>({ action: "listMetadata" }).finally(() => {
    if (pendingImages?.result === result) pendingImages = undefined;
  });
  pendingImages = { event, result };
  return result;
}
let pendingCategories: { event?: Event; result: Promise<string[]> } | undefined;
export function listLibraryCategories(event?: Event) {
  if (pendingCategories && (!event || pendingCategories.event === event)) return pendingCategories.result;
  const result = command<string[]>({ action: "listCategories" }).finally(() => {
    if (pendingCategories?.result === result) pendingCategories = undefined;
  });
  pendingCategories = { event, result };
  return result;
}
const thumbnails = new Map<string, Promise<string>>();
export function readLibraryThumbnail(id: string) {
  const cached = thumbnails.get(id);
  if (cached) { thumbnails.delete(id); thumbnails.set(id, cached); return cached; }
  const result = command<string>({ action: "thumbnail", id }).catch(error => {
    if (thumbnails.get(id) === result) thumbnails.delete(id);
    throw error;
  });
  thumbnails.set(id, result);
  if (thumbnails.size > 256) thumbnails.delete(thumbnails.keys().next().value!);
  return result;
}
export const createLibraryCategory = (name: string) => command<void>({ action: "createCategory", name: name.trim() });
export const deleteLibraryCategory = (name: string) => command<void>({ action: "deleteCategory", name: name.trim() });
export const renameLibraryCategory = (name:string,newName:string)=>command<void>({action:"renameCategory",name,new_name:newName.trim()});
export const orderLibraryCategories = (names:string[])=>command<void>({action:"orderCategories",names});
export const moveLibraryImages = (ids:string[],category:string,beforeId?:string,after=false)=>command<void>({action:"move",ids,category:category.trim(),before_id:beforeId||null,after});
export const scanLibraryImport = (paths:string[])=>command<{files:{path:string;category:string|null}[];skipped:number}>({action:"scan",paths});
export async function replaceLibraryImage(id:string,file:File){return command<{id:string}>({action:"replace",id,...await prepareLibraryImage(file)});}
export const readLibraryImage = (id: string) => command<string>({ action: "read", id });
export async function editLibraryImage(image: Pick<LibraryImage, "id" | "title" | "category" | "pinned" | "usedAt" | "caption">) {
  if (image.caption !== undefined && (typeof image.caption !== "string" || image.caption.length > 2000)) throw new Error("图片说明最多 2000 字符");
  await command({ action: "edit", id: image.id, title: image.title, category: image.category, pinned: image.pinned, used_at: image.usedAt, caption: image.caption });
}
export async function deleteLibraryImages(ids: string[]) {
  await command({ action: "delete", ids });
  for (const id of ids) thumbnails.delete(id);
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
  return images.filter(item => (category === "*" || item.category === category) && (view !== "pinned" || item.pinned) && (view !== "recent" || item.usedAt > 0) && words.every(word => normalize(`${item.title} ${item.category} ${item.caption || ""}`).includes(word)))
    .sort((a, b) => view === "recent" ? b.usedAt - a.usedAt : (a.sortOrder||0)-(b.sortOrder||0)||Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt);
}

export function libraryFolderCategory(relativePath:string){
  const parts=relativePath.replace(/\\/g,"/").split("/");parts.pop();
  if(!parts.length||parts.some(part=>!part||part==="."||part===".."))throw Error("Invalid image folder path");
  const category=parts.join("/");if(category.length>60||category==="*")throw Error("Folder category exceeds 60 characters");return category;
}
export function moveLibraryCategory(names:string[],source:string,target:string,after:boolean){
  if(source===target||!names.includes(source)||!names.includes(target))return names;
  const result=names.filter(name=>name!==source);result.splice(result.indexOf(target)+Number(after),0,source);return result;
}

export async function exportImageLibrary(images: LibraryImage[], categories = [...new Set(images.map(image => image.category).filter(Boolean))]) {
  const encoder = new TextEncoder();
  const base = { app: "WAP Plus CRM Image Library", version: 1, categories };
  const capacity = BACKUP_LIMIT - encoder.encode(JSON.stringify(base, null, 2)).length - 128;
  const volumes: LibraryImage[][] = [[]];
  let bytes = 0;
  for (const image of images) {
    const estimate = Math.ceil(image.size / 3) * 4 + encoder.encode(JSON.stringify([image.title, image.category, image.caption])).length + 1024;
    if (bytes + estimate > capacity && volumes.at(-1)!.length) { volumes.push([]); bytes = 0; }
    volumes.at(-1)!.push(image);
    bytes += estimate;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  for (const [index, images] of volumes.entries()) {
    const items = [];
    for (const image of images) {
      try {
        items.push({ title: image.title, category: image.category, caption: image.caption || "", pinned: image.pinned, usedAt: image.usedAt, data: await readLibraryImage(image.id) });
      } catch (error) { throw new Error(`${image.title}: ${String(error)}`); }
    }
    const suffix = volumes.length > 1 ? `-part-${index + 1}-of-${volumes.length}` : "";
    downloadJson(`wap-image-library-${stamp}${suffix}.json`, { ...base, items });
  }
  return volumes.length;
}

export function parseImageLibraryBackup(input: unknown): { title: string; category: string; caption: string; data: string; pinned: boolean; usedAt: number }[] {
  const value = input as { app?: unknown; version?: unknown; items?: unknown } | null;
  if (!value || value.app !== "WAP Plus CRM Image Library" || value.version !== 1 || !Array.isArray(value.items) || value.items.length > 3000) throw new Error("Invalid image library backup");
  let total = 0;
  return value.items.map(item => {
    if (!item || typeof item.title !== "string" || !item.title.trim() || item.title.length > 160 || typeof item.category !== "string" || item.category.length > 60 || typeof item.data !== "string" || !/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(item.data) || item.data.length > IMAGE_LIMIT * 4 / 3 + 128) throw new Error("Invalid image in library backup");
    if (item.caption !== undefined && (typeof item.caption !== "string" || item.caption.length > 2000)) throw new Error("Invalid image caption in library backup");
    total += item.data.length + new TextEncoder().encode(JSON.stringify(item.caption || "")).length; if (total > BACKUP_LIMIT) throw new Error("Backup exceeds 128 MB");
    return { title: item.title, category: item.category, caption: item.caption || "", data: item.data, pinned: item.pinned === true, usedAt: typeof item.usedAt === "number" && Number.isFinite(item.usedAt) && item.usedAt >= 0 && item.usedAt <= Date.now() ? item.usedAt : 0 };
  });
}

export async function restoreImageLibrary(file: File, onProgress: (done: number, total: number) => void, onFailures?: (failures: string[]) => void) {
  if (file.size > BACKUP_LIMIT) throw new Error("Backup exceeds 128 MB");
  const backup = JSON.parse(await file.text());
  const items = parseImageLibraryBackup(backup);
  const categories: unknown = backup.categories ?? [];
  if (!Array.isArray(categories) || categories.length > 3000 || categories.some(name => typeof name !== "string" || !name.trim() || name.trim() === "*" || name.length > 60)) throw new Error("Invalid image library categories");
  const failures: string[] = [];
  const failure = (label: string, error: unknown) => failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  for (const name of categories) {
    try { await createLibraryCategory(name); }
    catch (error) { failure(name, error); }
  }
  let added = 0;
  const ordered=new Map<string,string[]>();
  for (let index = 0; index < items.length; index++) {
    const item = items[index]!;
    try {
      const file = quickReplyMediaToFile({ dataUrl: item.data, fileName: item.title, mimeType: /^data:([^;,]+)/.exec(item.data)![1]!, kind: "image", token: "restore" });
      if (!file) throw new Error("Invalid image in library backup");
      const result = await addLibraryImage(file, item.category, item.title);
      await editLibraryImage({ ...item, id: result.id });
      added += Number(result.added);
      const ids = ordered.get(item.category) || [];
      if (!ids.includes(result.id)) ids.push(result.id);
      ordered.set(item.category, ids);
    } catch (error) { failure(item.title, error); }
    onProgress(index + 1, items.length);
  }
  for (const [category, ids] of ordered) {
    try { await moveLibraryImages(ids, category); }
    catch (error) { failure(category || "—", error); }
  }
  if (failures.length) {
    if (!onFailures) throw new Error(failures.join("\n"));
    onFailures(failures);
  }
  return added;
}
