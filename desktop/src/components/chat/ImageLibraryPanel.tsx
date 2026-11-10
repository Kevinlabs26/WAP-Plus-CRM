import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Plus, Sparkles, Star } from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/primitives";
import { useI18n } from "@/i18n";
import { useAppStore } from "@/store/appStore";
import { isTauri } from "@/lib/bridge";
import { addLibraryImage, createLibraryCategory, deleteLibraryCategory, deleteLibraryImages, editLibraryImage, exportImageLibrary, filterLibraryImages, listLibraryCategories, listLibraryImages, readLibraryImage, restoreImageLibrary, renameLibraryCategory, orderLibraryCategories, moveLibraryImages, replaceLibraryImage, scanLibraryImport, libraryFolderCategory, moveLibraryCategory, type LibraryImage } from "@/lib/imageLibrary";
import { emitQuickReplyMedia, quickReplyMediaToFile } from "@/lib/quickReplyMedia";
import { geminiGenerateImage, GEMINI_IMAGE_MODEL } from "@/lib/gemini";
import { openAiGenerateImage } from "@/lib/openAiImage";
import { applyExactImageText } from "@/lib/imageTextOverlay";
import { collectMuseWebMedia, generateMuseWebOutput } from "@/lib/museWeb";
import { trackAiRequest } from "@/lib/aiUsage";
import { useImageLibraryDrag, type LibraryDrag, type LibraryDrop } from "./useImageLibraryDrag";
import { takeImageGenerationRequest } from "@/lib/imageGenerationRequest";
import { imageGenerationReferences, type ImageReference } from "@/lib/imageGenerationReferences";
type GalleryRow = {
    key: string;
    category: string;
    images?: LibraryImage[];
    count: number;
};
type Menu = {
    kind: "root" | "image" | "category";
    id: string;
    x: number;
    y: number;
};
type Rename = {
    kind: "image" | "category";
    id: string;
    value: string;
};
type ImageProvider = "follow" | "gemini" | "vertex" | "openai" | "muse";
type ImageAspectRatio = "1:1" | "2:3" | "3:2";
async function prepareImageReference(dataUrl: string): Promise<Pick<ImageReference, "mimeType" | "data">> {
    const image = new Image();
    if (/^https?:/i.test(dataUrl)) image.crossOrigin = "anonymous";
    image.src = dataUrl;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40_000_000) throw Error("参考图尺寸无效或超过 40 MP");
    const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("图片读取失败");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const encoded = canvas.toDataURL("image/jpeg", 0.82).split(",")[1] || "";
    if (!encoded || encoded.length > 4_000_000) throw new Error("参考图片过大，无法发送给生成服务");
    return { mimeType: "image/jpeg", data: encoded };
}
const imageStylePresets = [
    { id: "photo", label: "gallery.stylePhoto", prompt: "photorealistic photography, natural lighting, lifelike materials, balanced composition" },
    { id: "warm", label: "gallery.styleWarmIllustration", prompt: "warm editorial illustration, gentle colors, friendly expressive shapes" },
    { id: "watercolor", label: "gallery.styleWatercolor", prompt: "hand-painted watercolor, visible paper texture, soft pigment edges" },
    { id: "minimal", label: "gallery.styleMinimalPoster", prompt: "minimalist poster design, clean negative space, clear visual hierarchy" },
    { id: "vintage", label: "gallery.styleVintageFilm", prompt: "vintage film look, subtle grain, muted warm colors" },
    { id: "elegant", label: "gallery.styleElegant", prompt: "elegant and reverent style, refined composition, restrained palette, soft light" },
] as const;
const imageTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
function initialCollapsed() { try {
    const value = JSON.parse(localStorage.getItem("wap-image-library-collapsed") || "[]");
    return new Set<string>(Array.isArray(value) ? value.filter(name => typeof name === "string").slice(0, 3000) : []);
}
catch {
    return new Set<string>();
} }
export function ImageLibraryPanel({ chatId, contextKey }: {
    chatId?: string | null;
    contextKey: string;
}) {
    const { t } = useI18n();
    const settings = useAppStore(state => state.settings);
    const [images, setImages] = useState<LibraryImage[]>([]), [customCategories, setCustomCategories] = useState<string[]>([]);
    const [query, setQuery] = useState(""), [category, setCategory] = useState("*"), [destination, setDestination] = useState("");
    const [creatingCategory, setCreatingCategory] = useState(false), [selecting, setSelecting] = useState(false), [view, setView] = useState<"all" | "pinned" | "recent">("all");
    const [selected, setSelected] = useState<string[]>([]), [collapsed, setCollapsed] = useState<Set<string>>(initialCollapsed);
    const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [importing, setImporting] = useState(false), [error, setError] = useState(""), [progress, setProgress] = useState("");
    const [preview, setPreview] = useState<LibraryImage | null>(null), [menu, setMenu] = useState<Menu | null>(null), [rename, setRename] = useState<Rename | null>(null);
    const [generateOpen, setGenerateOpen] = useState(false), [generated, setGenerated] = useState<{ mimeType: string; data: string } | null>(null), [generationReference, setGenerationReference] = useState<ImageReference | null>(null), [imageProvider, setImageProvider] = useState<ImageProvider>("follow");
    const [referenceMode, setReferenceMode] = useState<"style" | "portrait">("style");
    const [generationTarget, setGenerationTarget] = useState<string | null>(chatId || null);
    const upload = useRef<HTMLInputElement>(null), folderUpload = useRef<HTMLInputElement>(null), restore = useRef<HTMLInputElement>(null), replacement = useRef<HTMLInputElement>(null), replaceId = useRef("");
    const lock = useRef(false), cancelImport = useRef(false), mounted = useRef(true), context = useRef(contextKey), menuRef = useRef<HTMLDivElement>(null), renameRef = useRef(rename), range = useRef({ startIndex: 0, endIndex: 20 });
    context.current = contextKey;
    renameRef.current = rename;
    const pushToast = useAppStore(state => state.pushToast), requestConfirm = useAppStore(state => state.requestConfirm);
    const vertex = settings.vertexCredentialId && settings.vertexProjectId ? { vertexCredentialId: settings.vertexCredentialId, vertexProjectId: settings.vertexProjectId, vertexLocation: settings.vertexLocation || "global" } : undefined;
    const activeImageProvider = imageProvider === "follow" ? settings.aiProvider : imageProvider;
    const imageAuth = activeImageProvider === "muse" ? { provider: "muse" as const } : activeImageProvider === "openai" && settings.openaiKey.trim() ? { provider: "openai" as const, apiKey: settings.openaiKey } : activeImageProvider === "gemini" && settings.geminiKey.trim() ? { provider: "gemini" as const, apiKey: settings.geminiKey } : activeImageProvider === "vertex" && vertex ? { provider: "vertex" as const, apiKey: "", vertex } : null;
    const categories = useMemo(() => [...new Set([...customCategories, ...images.map(image => image.category).filter(Boolean)])], [customCategories, images]);
    const filtered = useMemo(() => filterLibraryImages(images, query, "*", view), [images, query, view]);
    const byId = new Map(images.map(image => [image.id, image])), chosen = selected.flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
    const rows = useMemo(() => {
        const groups = new Map<string, LibraryImage[]>();
        for (const image of filtered) {
            const group = groups.get(image.category) || [];
            group.push(image);
            groups.set(image.category, group);
        }
        const output: GalleryRow[] = [];
        for (const name of [...(images.some(image => !image.category) ? [""] : []), ...categories]) {
            const group = groups.get(name) || [];
            if ((query.trim() || view !== "all") && !group.length)
                continue;
            output.push({ key: "category:" + name, category: name, count: group.length });
            if (!collapsed.has(name) || query.trim())
                for (let i = 0; i < group.length; i += 2)
                    output.push({ key: "images:" + group[i]!.id, category: name, images: group.slice(i, i + 2), count: group.length });
        }
        return output;
    }, [filtered, categories, collapsed, query, view, images]);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; cancelImport.current = true; }; }, []);
    useEffect(() => { setPreview(null); setMenu(null); setRename(null); }, [contextKey]);
    useEffect(() => { try {
        localStorage.setItem("wap-image-library-collapsed", JSON.stringify([...collapsed]));
    }
    catch { /* UI preference only. */ } }, [collapsed]);
    useEffect(() => {
        let stopped = false, generation = 0;
        const load = async () => { const request = ++generation; try {
            const [items, names] = await Promise.all([listLibraryImages(), listLibraryCategories()]);
            if (!stopped && request === generation) {
                setImages(items);
                setCustomCategories(names);
                setSelected(ids => ids.filter(id => items.some(image => image.id === id)));
            }
        }
        catch (error) {
            if (!stopped)
                setError(String(error));
        }
        finally {
            if (!stopped)
                setLoading(false);
        } };
        if (isTauri())
            void load();
        else
            setLoading(false);
        window.addEventListener("wap:image-library", load);
        return () => { stopped = true; window.removeEventListener("wap:image-library", load); };
    }, []);
    useEffect(() => { if (!menu)
        return; menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus(); const outside = (event: Event) => { if (!menuRef.current?.contains(event.target as Node))
        setMenu(null); }; const key = (event: KeyboardEvent) => { if (event.key === "Escape")
        setMenu(null); }; window.addEventListener("pointerdown", outside); window.addEventListener("keydown", key); window.addEventListener("blur", outside); return () => { window.removeEventListener("pointerdown", outside); window.removeEventListener("keydown", key); window.removeEventListener("blur", outside); }; }, [menu]);
    const run = async (work: () => Promise<void>) => { if (lock.current)
        return; lock.current = true; setBusy(true); setError(""); setProgress(""); try {
        await work();
    }
    catch (error) {
        if (mounted.current)
            setError(String(error));
    }
    finally {
        lock.current = false;
        if (mounted.current) {
            setBusy(false);
            setImporting(false);
        }
        window.dispatchEvent(new Event("wap:image-library"));
    } };
    useEffect(() => {
        let active = true;
        const receive = () => {
            if (lock.current) return;
            const request = takeImageGenerationRequest();
            if (!request) return;
            void run(async () => {
                const reference = await prepareImageReference(request.source);
                if (!active || request.chatId && request.chatId !== useAppStore.getState().selectedChatId) throw Error(t("gallery.chatChanged"));
                setGenerationReference({ title: request.title, ...reference });
                setReferenceMode(request.mode);
                setGenerationTarget(request.chatId);
                setGenerated(null);
                setGenerateOpen(true);
            });
        };
        window.addEventListener("wap:image-generation-request", receive);
        const timer = window.setTimeout(receive, 0);
        return () => { active = false; window.clearTimeout(timer); window.removeEventListener("wap:image-generation-request", receive); };
    }, [contextKey]);
    const openCategory = (name: string) => { setCategory(name); setCollapsed(values => { const next = new Set(values); next.delete(name); return next; }); };
    const moveImages = (ids: string[], name: string, before?: string, after = false) => run(async () => { await moveLibraryImages(ids, name, before, after); setSelected([]); openCategory(name); });
    const onDrop = (source: LibraryDrag, target: LibraryDrop) => {
        if (lock.current)
            return;
        if (source.kind === "category") {
            const names = moveLibraryCategory(categories, source.id, target.category, target.after);
            if (names !== categories)
                void run(async () => { await orderLibraryCategories(names); setCustomCategories(names); });
        }
        else {
            const ids = selected.includes(source.id) ? selected : [source.id];
            if (target.imageId && ids.includes(target.imageId))
                return;
            void moveImages(ids, target.category, target.imageId, target.after);
        }
    };
    const reorderKey = (event: React.KeyboardEvent, source: LibraryDrag) => {
        const keys = source.kind === "category" ? ["ArrowUp", "ArrowDown"] : ["ArrowLeft", "ArrowRight"];
        if (!event.altKey || !keys.includes(event.key) || busy)
            return;
        event.preventDefault();
        event.stopPropagation();
        if (source.kind === "image" && view === "recent")
            return;
        const image = byId.get(source.id), order = source.kind === "category" ? categories : filterLibraryImages(images, "", image?.category || "", "all").map(image => image.id), index = order.indexOf(source.id), after = event.key === keys[1], target = order[index + (after ? 1 : -1)];
        if (target !== undefined)
            onDrop(source, { category: source.kind === "category" ? target : image!.category, ...(source.kind === "image" ? { imageId: target } : {}), after });
    };
    const drag = useImageLibraryDrag(contextKey, onDrop);
    const removeCategory = (name: string) => run(async () => { if (!name || name === "*" || !await requestConfirm({ title: t("gallery.deleteCategoryConfirm", { name }), description: t("gallery.deleteCategoryHint"), tone: "danger" }))
        return; await deleteLibraryCategory(name); if (category === name)
        setCategory("*"); setCustomCategories(names => names.filter(value => value !== name)); });
    const removeImages = (ids: string[]) => run(async () => { if (await requestConfirm({ title: t("gallery.deleteConfirm", { count: ids.length }), tone: "danger" })) {
        await deleteLibraryImages(ids);
        setSelected([]);
        setPreview(null);
    } });
    const importFiles = (sources: (File | string)[], folder = false) => run(async () => {
        if (!sources.length)
            return;
        setImporting(true);
        cancelImport.current = false;
        let added = 0, duplicates = 0, failures = 0, skipped = 0, detail = "";
        const touched = new Set<string>();
        let inputs: {
            file?: File;
            path?: string;
            category: string | null;
        }[] = [];
        if (sources.every(source => typeof source === "string")) {
            setProgress(t("gallery.scanning"));
            const scan = await scanLibraryImport(sources as string[]);
            inputs = scan.files;
            skipped = scan.skipped;
        }
        else
            for (const source of sources) {
                if (typeof source === "string")
                    throw Error("Invalid image import selection");
                if (!imageTypes.has(source.type)) {
                    skipped++;
                    continue;
                }
                inputs.push({ file: source, category: folder ? libraryFolderCategory(source.webkitRelativePath) : null });
            }
        if (inputs.length > 3000)
            throw Error(t("gallery.tooMany"));
        for (let index = 0; index < inputs.length; index++) {
            if (cancelImport.current)
                break;
            const source = inputs[index]!;
            try {
                let file = source.file;
                if (!file) {
                    const data = await invoke<{
                        name: string;
                        mime: string;
                        bytes: number[];
                    }>("read_dropped_file", { path: source.path });
                    file = new File([new Uint8Array(data.bytes)], data.name, { type: data.mime });
                }
                if (cancelImport.current)
                    break;
                const name = source.category ?? (category === "*" ? "" : category), result = await addLibraryImage(file, name);
                if (result.added)
                    added++;
                else
                    duplicates++;
                touched.add(name);
            }
            catch (error) {
                failures++;
                detail = (source.file?.name || source.path?.split(/[\\/]/).pop() || "") + ": " + String(error);
            }
            if (mounted.current)
                setProgress((index + 1) + "/" + inputs.length);
        }
        if (!mounted.current)
            return;
        setProgress((cancelImport.current ? t("gallery.importStopped") + " · " : "") + t("gallery.importResult", { added, duplicates, failures }) + (skipped ? " · " + t("gallery.skipped", { count: skipped }) : ""));
        if (failures)
            setError(detail);
        setCollapsed(values => new Set([...values].filter(name => !touched.has(name))));
        setQuery("");
        setView("all");
    });
    const importRef = useRef(importFiles);
    importRef.current = importFiles;
    useEffect(() => { const drop = (event: Event) => { const paths = (event as CustomEvent<unknown>).detail; if (Array.isArray(paths) && paths.every(path => typeof path === "string"))
        void importRef.current(paths); }; window.addEventListener("wap:image-library-drop", drop); return () => window.removeEventListener("wap:image-library-drop", drop); }, []);
    const showMenu = (event: React.MouseEvent, kind: Menu["kind"], id = "") => { if (["INPUT", "TEXTAREA", "SELECT"].includes((event.target as HTMLElement)?.tagName) || (event.target as HTMLElement)?.closest?.("dialog"))
        return; event.preventDefault(); event.stopPropagation?.(); if (!lock.current)
        setMenu({ kind, id, x: event.clientX || 8, y: event.clientY || 8 }); };
    const beginRename = (kind: Rename["kind"], id: string) => { const value = kind === "image" ? byId.get(id)?.title : id; if (value !== undefined) {
        setRename({ kind, id, value });
        setMenu(null);
    } };
    const saveRename = () => { const edit = renameRef.current; if (!edit || lock.current)
        return; const value = edit.value.trim(); if (!value) {
        setError(t("gallery.nameRequired"));
        return;
    } renameRef.current = null; setRename(null); void run(async () => { try {
        if (edit.kind === "category") {
            await renameLibraryCategory(edit.id, value);
            setCollapsed(values => new Set([...values].map(name => name === edit.id ? value : name)));
            if (category === edit.id)
                setCategory(value);
        }
        else {
            const image = byId.get(edit.id);
            if (!image)
                throw Error(t("gallery.noMatches"));
            await editLibraryImage({ ...image, title: value });
        }
    }
    catch (error) {
        if (mounted.current)
            setRename(edit);
        throw error;
    } }); };
    const renameInput = () => <input autoFocus aria-label={t(rename!.kind === "category" ? "gallery.categoryName" : "gallery.name")} className="ui-control h-8 min-w-0 w-full px-2 text-xs" value={rename!.value} maxLength={rename!.kind === "category" ? 60 : 160} onChange={event => setRename({ ...rename!, value: event.target.value })} onBlur={saveRename} onKeyDown={event => { if (event.key === "Enter") {
        event.preventDefault();
        saveRename();
    } if (event.key === "Escape") {
        event.preventDefault();
        renameRef.current = null;
        setRename(null);
    } }}/>;
    // shortcut: batch captions apply to the first image; extend when the composer supports per-image captions.
    const insert = async (items: LibraryImage[], caption = items[0]?.caption || "", saveEdits = false) => {
        if (!chatId || !items.length)
            return;
        if (items.length > 5) {
            setError(t("gallery.sendLimit"));
            return;
        }
        const captured = contextKey;
        await run(async () => {
            if (saveEdits)
                await editLibraryImage(items[0]!);
            const media = [];
            for (const image of items)
                media.push({ dataUrl: await readLibraryImage(image.id), fileName: image.title + (image.title.includes(".") ? "" : "." + image.mime.split("/")[1]), mimeType: image.mime, kind: "image" as const });
            if (!mounted.current || captured !== context.current || useAppStore.getState().selectedChatId !== chatId)
                throw Error(t("gallery.chatChanged"));
            const [first, ...additionalMedia] = media;
            if (!first || !emitQuickReplyMedia({ ...first, additionalMedia, caption, token: crypto.randomUUID(), target: "main", chatId }))
                throw Error(t("quickShelf.insertUnavailable"));
            setPreview(null);
            setSelected([]);
            pushToast(t("quickShelf.mediaInserted"), "success");
            for (const image of items)
                await editLibraryImage({ ...image, usedAt: Date.now() });
        });
    };
    const generateFromReference = async (image: LibraryImage) => {
        setError("");
        try {
            const reference = await prepareImageReference(await readLibraryImage(image.id));
            setGenerationReference({ title: image.title, ...reference });
            setReferenceMode("style");
            setGenerationTarget(chatId || null);
            setGenerated(null);
            setGenerateOpen(true);
        } catch (error) { setError(`${t("gallery.referenceReadFailed")}: ${String(error)}`); }
    };
    const generateImage = (options: { prompt: string; aspectRatio: ImageAspectRatio; exactText: string; stylePrompt?: string; subjectImage?: ImageReference | null; styleImage?: ImageReference | null }) => run(async () => {
        if (!imageAuth)
            throw Error(t("gallery.aiSetup"));
        setGenerated(null);
        setError("");
        const ratioPrompt = options.aspectRatio === "2:3" ? "Use a vertical portrait composition with a 2:3 aspect ratio." : options.aspectRatio === "3:2" ? "Use a horizontal landscape composition with a 3:2 aspect ratio." : "Use a square composition with a 1:1 aspect ratio.";
        const exactTextPrompt = options.exactText.trim() ? "Create the background only: do not render any words, letters, numbers, logos, or watermarks. Keep the lower area simple and readable; the exact text will be added by the app." : "";
        const references = imageGenerationReferences(options.subjectImage, options.styleImage);
        const prompt = [options.prompt.trim(), references.instructions, options.stylePrompt ? `Visual style: ${options.stylePrompt}. Apply this style only; preserve the requested subject and facts.` : "", ratioPrompt, exactTextPrompt].filter(Boolean).join("\n\n");
        const referenceDataUrls = references.images.map(image => `data:${image.mimeType};base64,${image.data}`);
        let result = imageAuth.provider === "muse"
            ? await trackAiRequest({ provider: "muse", model: "muse-web", feature: "image" }, async () => {
                const output = await generateMuseWebOutput(`Generate and attach the image or video requested below. Do not only describe it. Use Muse's media generation feature.\n\n${prompt}`, undefined, undefined, undefined, references.images.map((image, index) => ({ mimeType: image.mimeType, dataUrl: referenceDataUrls[index]! })), true);
                if (!output.media) throw Error(t("gallery.museNoMedia"));
                return output.media;
            })
            : imageAuth.provider === "openai" ? await openAiGenerateImage(imageAuth.apiKey, prompt, options.aspectRatio, referenceDataUrls) : await geminiGenerateImage({ ...imageAuth, prompt, model: GEMINI_IMAGE_MODEL, aspectRatio: options.aspectRatio, referenceImages: references.images.map(image => ({ mimeType: image.mimeType, data: image.data })) });
        if (options.exactText.trim() && result.mimeType.startsWith("image/")) {
            let composed;
            try { composed = await applyExactImageText(result, options.exactText); }
            catch { throw Error(t("gallery.exactTextFailed")); }
            if (!composed) throw Error(t("gallery.exactTextTooLong"));
            result = composed;
        }
        setGenerated(result);
    });
    const generatedDataUrl = generated ? `data:${generated.mimeType};base64,${generated.data}` : "";
    const collectGenerated = (exactText: string) => run(async () => {
        let result: { mimeType: string; data: string } = await collectMuseWebMedia();
        if (exactText.trim() && result.mimeType.startsWith("image/")) {
            const composed = await applyExactImageText(result, exactText);
            if (!composed) throw Error(t("gallery.exactTextTooLong"));
            result = composed;
        }
        setGenerated(result);
    });
    const generatedTitle = (prompt: string) => `AI · ${prompt.trim().slice(0, 54)}`;
    const saveGenerated = (prompt: string) => run(async () => {
        if (!generated)
            return;
        if (generated.mimeType.startsWith("video/")) throw Error(t("gallery.videoNotSaved"));
        const title = generatedTitle(prompt), fileName = `${title}.${generated.mimeType.split("/")[1] === "jpeg" ? "jpg" : generated.mimeType.split("/")[1]}`;
        const file = quickReplyMediaToFile({ dataUrl: generatedDataUrl, fileName, mimeType: generated.mimeType, kind: "image", token: "ai-image" });
        if (!file)
            throw Error(t("gallery.invalidGenerated"));
        await addLibraryImage(file, category === "*" ? "" : category, title);
        setGenerateOpen(false);
        setGenerated(null);
        setProgress(t("gallery.saved"));
    });
    const insertGenerated = (prompt: string) => run(async () => {
        if (!generated || !generationTarget)
            return;
        if (useAppStore.getState().selectedChatId !== generationTarget || context.current !== contextKey)
            throw Error(t("gallery.chatChanged"));
        const title = generatedTitle(prompt), extension = generated.mimeType.split("/")[1] === "jpeg" ? "jpg" : generated.mimeType.split("/")[1];
        const kind = generated.mimeType.startsWith("video/") ? "video" : "image";
        if (!emitQuickReplyMedia({ dataUrl: generatedDataUrl, fileName: `${title}.${extension}`, mimeType: generated.mimeType, kind, token: crypto.randomUUID(), target: "main", chatId: generationTarget }))
            throw Error(t("quickShelf.insertUnavailable"));
        setGenerateOpen(false);
        setGenerated(null);
        pushToast(t("quickShelf.mediaInserted"), "success");
    });
    const menuImage = menu?.kind === "image" ? byId.get(menu.id) : undefined, menuIds = menuImage ? (selected.includes(menuImage.id) ? selected : [menuImage.id]) : [];
    const menuAction = (work: () => void) => () => { setMenu(null); work(); };
    const card = (image: LibraryImage) => <article key={image.id} data-library-image={image.id} onContextMenu={event => showMenu(event, "image", image.id)} className={"group relative min-w-0 rounded-lg p-1 " + (selected.includes(image.id) ? "ring-1 ring-brand bg-brand/10 " : "") + (drag.target?.imageId === image.id ? "ring-2 ring-brand " : "")}>
    <div className="absolute inset-x-2 top-2 z-[1] flex justify-between gap-1">{selecting ? <input type="checkbox" disabled={busy} aria-label={t("gallery.selectNamed", { title: image.title })} checked={selected.includes(image.id)} onChange={event => setSelected(ids => event.target.checked ? [...ids, image.id] : ids.filter(id => id !== image.id))}/> : <button {...(!busy && view !== "recent" ? drag.handle({ kind: "image", id: image.id }) : {})} type="button" onKeyDown={event => reorderKey(event, { kind: "image", id: image.id })} disabled={busy || view === "recent"} aria-label={t("gallery.dragImage")} title={t("gallery.dragImage")} className="touch-none select-none cursor-grab rounded bg-zinc-900/80 px-1 text-zinc-500 opacity-0 group-hover:opacity-100 focus:opacity-100">⠿</button>}
    <button type="button" className="ml-auto rounded-full bg-zinc-900 p-1 shadow-sm" disabled={busy} aria-label={t(image.pinned ? "quickShelf.unpin" : "quickShelf.pin", { title: image.title })} aria-pressed={image.pinned} onClick={() => void run(async () => editLibraryImage({ ...image, pinned: !image.pinned }))}><Star className={"h-3.5 w-3.5 " + (image.pinned ? "fill-amber-400 text-amber-400" : "text-zinc-500")}/></button></div>
    <button {...(!busy && view !== "recent" && !selecting ? drag.handle({ kind: "image", id: image.id }) : {})} type="button" disabled={busy} className="block w-full rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand" onClick={() => { if (selecting) {
        setSelected(ids => ids.includes(image.id) ? ids.filter(id => id !== image.id) : [...ids, image.id]);
    }
    else {
        setError("");
        setPreview(image);
    } }} aria-pressed={selecting ? selected.includes(image.id) : undefined} aria-label={t(selecting ? "gallery.selectNamed" : "quickShelf.previewNamed", { title: image.title })}><img src={image.thumbnail} draggable={false} alt={image.title} loading="lazy" decoding="async" className="aspect-square w-full rounded-lg bg-zinc-800 object-contain"/></button>
    {rename?.kind === "image" && rename.id === image.id ? renameInput() : <span className="mt-1 block truncate text-left text-2xs" title={image.title} onDoubleClick={() => { if (!busy)
        beginRename("image", image.id); }}>{image.title}</span>}
    {!selecting && <button type="button" className="absolute bottom-8 right-2 flex h-7 w-7 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 p-0 text-brand shadow-sm" aria-label={t("quickShelf.insert")} title={t("quickShelf.insert")} disabled={busy || !chatId} onClick={() => void insert([image])}><Plus aria-hidden="true" className="h-4 w-4 shrink-0"/></button>}
  </article>;
    if (!isTauri())
        return <p className="p-4 text-xs text-zinc-500">{t("gallery.desktopOnly")}</p>;
    return <section ref={drag.root} {...drag.events} data-image-library-drop onContextMenu={event => showMenu(event, "root")} className={"flex min-h-0 flex-1 flex-col " + (drag.active ? "select-none" : "")} aria-label={t("gallery.title")} onDragOver={event => { event.preventDefault(); event.stopPropagation(); }} onDrop={event => { event.preventDefault(); event.stopPropagation(); if (!lock.current)
        void importFiles(Array.from(event.dataTransfer.files)); }}>
    <header className="shrink-0 space-y-2 border-b border-zinc-800 p-2"><h3 className="truncate text-xs font-semibold">{t("gallery.title")} <span className="font-normal text-zinc-500">{images.length}</span></h3><div className="flex flex-wrap gap-1"><Button size="xs" disabled={busy} onClick={() => { setError(""); setGenerated(null); setGenerationReference(null); setGenerationTarget(chatId || null); setGenerateOpen(true); }}><Sparkles className="mr-1 h-3.5 w-3.5"/>{t("gallery.generate")}</Button><Button size="xs" disabled={busy || loading} onClick={() => upload.current?.click()}><ImagePlus className="mr-1 h-3.5 w-3.5"/>{t("gallery.importImages")}</Button><Button size="xs" disabled={busy || loading} onClick={() => folderUpload.current?.click()}>{t("gallery.importFolder")}</Button><Button size="xs" disabled={busy} onClick={() => { setSelecting(value => !value); setSelected([]); }}>{t(selecting ? "common.close" : "gallery.multiSelect")}</Button></div>
      <input ref={upload} type="file" hidden multiple accept="image/png,image/jpeg,image/gif,image/webp" onChange={event => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ""; void importFiles(files); }}/>
      <input ref={folderUpload} type="file" hidden multiple {...{ webkitdirectory: "", directory: "" }} aria-label={t("gallery.importFolder")} onChange={event => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ""; void importFiles(files, true); }}/>
      <input ref={restore} type="file" hidden accept="application/json,.json" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file)
        void run(async () => { const added = await restoreImageLibrary(file, (done, total) => setProgress(done + "/" + total)); setProgress(t("gallery.restored", { count: added })); }); }}/>
      <input ref={replacement} type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp" aria-label={t("gallery.replaceImage")} onChange={event => { const file = event.currentTarget.files?.[0], id = replaceId.current; event.currentTarget.value = ""; if (file && id)
        void run(async () => { await replaceLibraryImage(id, file); setPreview(null); }); }}/>
      <input className="ui-control h-8 w-full px-2 text-xs" aria-label={t("gallery.search")} placeholder={t("gallery.search")} value={query} onChange={event => setQuery(event.target.value)}/>
      <nav className="flex items-center gap-1" aria-label={t("gallery.category")}>{(["all", "pinned", "recent"] as const).map(value => <button key={value} type="button" aria-pressed={view === value} onClick={() => { setView(value); setCategory("*"); }} className={"rounded-full px-2.5 py-1 text-2xs " + (view === value ? "bg-brand/10 text-brand" : "text-zinc-500 hover:bg-zinc-800")}>{t(`quickShelf.view.${value}`)}</button>)}<button type="button" disabled={busy} aria-label={t("gallery.createCategory")} title={t("gallery.createCategory")} className="ml-auto rounded px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-800" onClick={() => { setCreatingCategory(value => !value); setDestination(""); }}>＋</button></nav>
      {(creatingCategory || !!chosen.length) && <form className="flex gap-1" onSubmit={event => { event.preventDefault(); const name = destination.trim(); if (!name)
        return; void run(async () => { if (!categories.includes(name))
        await createLibraryCategory(name); if (chosen.length) {
        await moveLibraryImages(chosen.map(image => image.id), name);
        setSelected([]);
    } setCreatingCategory(false); openCategory(name); setDestination(""); setQuery(""); setView("all"); }); }}><input autoFocus aria-label={t("gallery.categoryName")} placeholder={t("gallery.categoryName")} list="image-library-categories" value={destination} maxLength={60} onChange={event => setDestination(event.target.value)} className="ui-control h-8 min-w-0 flex-1 px-2 text-xs"/><Button type="submit" size="xs" disabled={busy || loading || !destination.trim() || !chosen.length && categories.includes(destination.trim())}>{t(chosen.length ? "gallery.move" : "gallery.createCategory")}</Button></form>}
      <datalist id="image-library-categories">{categories.map(value => <option key={value} value={value}/>)}</datalist>
    </header>
    {(error || progress || loading || importing) && <div aria-live="polite" className="shrink-0 break-words p-2 text-2xs">{loading && <p>{t("gallery.loading")}</p>}{progress && <p>{progress}</p>}{error && <p role="alert" className="text-rose-400">{error}</p>}{importing && <Button size="xs" onClick={() => { cancelImport.current = true; }}>{t("gallery.cancelImport")}</Button>}</div>}
    <Virtuoso className="min-h-0 flex-1" style={{ minHeight: 100 }} data={rows} computeItemKey={(_index, row) => row.key} increaseViewportBy={120} scrollerRef={element => { if (element instanceof HTMLElement)
        drag.scroller.current = element; }} rangeChanged={value => { range.current = value; }} itemContent={(_index, row) => row.images ? <div data-library-category={row.category} className="grid grid-cols-2 gap-2 px-2 pb-2">{row.images.map(card)}</div> : <div data-library-category={row.category} className={"mx-2 my-2 rounded-lg " + (drag.target?.category === row.category && !drag.target.imageId ? "ring-2 ring-brand " : "") + (category === row.category ? "bg-brand/10" : "bg-zinc-800/50")} onContextMenu={event => showMenu(event, "category", row.category)}><div className="flex items-center gap-1 px-1">{row.category && <button {...(!busy ? drag.handle({ kind: "category", id: row.category }) : {})} type="button" onKeyDown={event => reorderKey(event, { kind: "category", id: row.category })} disabled={busy} aria-label={t("gallery.dragCategory")} title={t("gallery.dragCategory")} className="touch-none select-none cursor-grab p-1 text-xs text-zinc-500">⠿</button>}{rename?.kind === "category" && rename.id === row.category ? renameInput() : <button {...(!busy && row.category ? drag.handle({ kind: "category", id: row.category }) : {})} type="button" onKeyDown={event => reorderKey(event, { kind: "category", id: row.category })} onContextMenu={event => showMenu(event, "category", row.category)} title={row.category || t("gallery.uncategorized")} aria-expanded={!!query.trim() || !collapsed.has(row.category)} aria-pressed={category === row.category} disabled={busy} className="flex min-w-0 flex-1 items-center gap-2 px-1 py-2 text-xs" onClick={() => { setCategory(row.category); setCollapsed(values => { const next = new Set(values); if (next.has(row.category))
        next.delete(row.category);
    else
        next.add(row.category); return next; }); }}><span aria-hidden="true">{!query.trim() && collapsed.has(row.category) ? "+" : "−"}</span><span className="min-w-0 flex-1 truncate text-left">{row.category || t("gallery.uncategorized")}</span><span className="text-zinc-500">{row.count}</span></button>}</div></div>}/>
    {!loading && !rows.length && <p className="p-5 text-center text-xs text-zinc-500">{t(images.length ? "gallery.noMatches" : "gallery.empty")}</p>}
    {selecting && <footer className="shrink-0 space-y-2 border-t border-zinc-800 p-2"><div className="flex items-center gap-2 text-2xs"><button type="button" className="text-zinc-500" disabled={busy} onClick={() => setSelected(ids => [...new Set([...ids, ...rows.slice(range.current.startIndex, range.current.endIndex + 1).flatMap(row => row.images?.map(image => image.id) || [])])])}>{t("gallery.selectPage")}</button><span className="flex-1 text-right text-zinc-500">{t("gallery.selected", { count: chosen.length })}</span></div>{!!chosen.length && <div className="flex flex-wrap gap-1"><Button size="xs" disabled={busy || !chatId || chosen.length > 5} onClick={() => void insert(chosen)}>{t("gallery.insertSelected")}</Button><Button size="xs" disabled={busy} onClick={() => void removeImages(chosen.map(image => image.id))}>{t("common.delete")}</Button></div>}</footer>}
    {menu && <div ref={menuRef} role="menu" aria-label={t("gallery.more")} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }} className="fixed z-50 flex max-h-[65vh] w-56 flex-col gap-1 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 p-1.5 text-xs shadow-xl" style={{ left: Math.max(4, Math.min(menu.x, (window.innerWidth || 320) - 228)), top: Math.max(4, Math.min(menu.y, (window.innerHeight || 768) - 360)) }} onKeyDown={event => { if (!["ArrowUp", "ArrowDown"].includes(event.key))
            return; const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")); const index = buttons.indexOf(document.activeElement as HTMLButtonElement); event.preventDefault(); buttons[(index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus(); }}>
      {menuImage && <><Button size="xs" role="menuitem" onClick={menuAction(() => void generateFromReference(menuImage))}>{t("gallery.createInStyle")}</Button><Button size="xs" role="menuitem" onClick={menuAction(() => setPreview(menuImage))}>{t("quickShelf.preview")}</Button><Button size="xs" role="menuitem" onClick={menuAction(() => beginRename("image", menuImage.id))}>{t("gallery.rename")}</Button><Button size="xs" role="menuitem" onClick={menuAction(() => { replaceId.current = menuImage.id; replacement.current?.click(); })}>{t("gallery.replaceImage")}</Button><Button size="xs" role="menuitem" onClick={menuAction(() => void run(async () => editLibraryImage({ ...menuImage, pinned: !menuImage.pinned })))}>{t(menuImage.pinned ? "gallery.unfavorite" : "gallery.favorite")}</Button><label className="px-2 py-1">{t("gallery.move")}<select className="ui-control mt-1 w-full px-1 text-xs" value="__choose" onChange={event => { const name = event.target.value; setMenu(null); void moveImages(menuIds, name); }}><option value="__choose" disabled>{t("gallery.categoryName")}</option><option value="">{t("gallery.uncategorized")}</option>{categories.map(name => <option key={name} value={name}>{name}</option>)}</select></label><Button size="xs" role="menuitem" className="text-rose-400" onClick={menuAction(() => void removeImages(menuIds))}>{t("common.delete")}</Button></>}
      {menu.kind === "category" && <><Button size="xs" role="menuitem" onClick={menuAction(() => { openCategory(menu.id); upload.current?.click(); })}>{t("gallery.importImages")}</Button>{!!menu.id && <><Button size="xs" role="menuitem" onClick={menuAction(() => beginRename("category", menu.id))}>{t("gallery.rename")}</Button><Button size="xs" role="menuitem" onClick={menuAction(() => { setSelecting(true); setSelected(images.filter(image => image.category === menu.id).map(image => image.id)); })}>{t("gallery.selectCategory")}</Button><Button size="xs" role="menuitem" className="text-rose-400" onClick={menuAction(() => void removeCategory(menu.id))}>{t("gallery.deleteCategory")}</Button></>}</>}
      {menu.kind === "root" && <><Button size="xs" role="menuitem" onClick={menuAction(() => upload.current?.click())}>{t("gallery.importImages")}</Button><Button size="xs" role="menuitem" onClick={menuAction(() => folderUpload.current?.click())}>{t("gallery.importFolder")}</Button><Button size="xs" role="menuitem" onClick={menuAction(() => { setCreatingCategory(true); setDestination(""); })}>{t("gallery.createCategory")}</Button><Button size="xs" role="menuitem" onClick={menuAction(() => setCollapsed(new Set()))}>{t("gallery.expandAll")}</Button><Button size="xs" role="menuitem" onClick={menuAction(() => setCollapsed(new Set(["", ...categories])))}>{t("gallery.collapseAll")}</Button><Button size="xs" role="menuitem" disabled={!images.length && !categories.length} onClick={menuAction(() => void run(async () => { await exportImageLibrary(chosen.length ? chosen : images, chosen.length ? [...new Set(chosen.map(image => image.category).filter(Boolean))] : categories); setProgress(t("gallery.exported")); }))}>{t("gallery.backup")}</Button><Button size="xs" role="menuitem" onClick={menuAction(() => restore.current?.click())}>{t("gallery.restore")}</Button></>}
    </div>}
    {preview && <ImageLibraryPreview key={contextKey + ":" + preview.id} image={preview} busy={busy} saveError={error} canInsert={!!chatId} categories={categories} onClose={() => setPreview(null)} onInsert={image => void insert([image], image.caption, true)} onSave={image => void run(async () => { await editLibraryImage(image); setPreview(null); })}/>}
    {generateOpen && <ImageGenerationDialog busy={busy} error={error} canGenerate={!!imageAuth} generated={generated} referenceImage={generationReference} referenceMode={referenceMode} libraryImages={images} onClearReference={() => setGenerationReference(null)} provider={imageProvider} onProviderChange={setImageProvider} providerOptions={[{ value: "follow", label: t("gallery.followAI"), disabled: false }, { value: "muse", label: t("gallery.muse"), disabled: false }, { value: "gemini", label: t("gallery.gemini"), disabled: !settings.geminiKey.trim() }, { value: "vertex", label: t("gallery.vertex"), disabled: !vertex }, { value: "openai", label: t("gallery.openai"), disabled: !settings.openaiKey.trim() }]} costHint={imageAuth?.provider === "muse" ? t("gallery.museMediaCost") : imageAuth?.provider === "openai" ? t("gallery.openAiCost") : imageAuth ? t("gallery.geminiCost") : t("gallery.aiSetup")} onClose={() => { setGenerateOpen(false); setGenerated(null); setGenerationReference(null); setError(""); }} onGenerate={generateImage} canCollect={imageAuth?.provider === "muse"} onCollect={collectGenerated} onSave={saveGenerated} onInsert={insertGenerated} canInsert={!!generationTarget}/>}
  </section>;
}

function ImageGenerationDialog({ busy, error, canGenerate, generated, referenceImage, referenceMode, libraryImages, onClearReference, provider, onProviderChange, providerOptions, costHint, onClose, onGenerate, canCollect, onCollect, onSave, onInsert, canInsert }: { busy: boolean; error: string; canGenerate: boolean; generated: { mimeType: string; data: string } | null; referenceImage: ImageReference | null; referenceMode: "style" | "portrait"; libraryImages: LibraryImage[]; onClearReference: () => void; provider: ImageProvider; onProviderChange: (provider: ImageProvider) => void; providerOptions: { value: ImageProvider; label: string; disabled: boolean }[]; costHint: string; onClose: () => void; onGenerate: (options: { prompt: string; aspectRatio: ImageAspectRatio; exactText: string; stylePrompt?: string; subjectImage?: ImageReference | null; styleImage?: ImageReference | null }) => void; canCollect: boolean; onCollect: (exactText: string) => void; onSave: (prompt: string) => void; onInsert: (prompt: string) => void; canInsert: boolean }) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("");
  const [aspectRatio, setAspectRatio] = useState<ImageAspectRatio>("1:1");
  const [exactText, setExactText] = useState("");
  const [additionalSubject, setAdditionalSubject] = useState<ImageReference | null>(null), [additionalStyle, setAdditionalStyle] = useState<ImageReference | null>(null);
  const [referenceLoading, setReferenceLoading] = useState(false), [referenceError, setReferenceError] = useState("");
  const subjectUpload = useRef<HTMLInputElement>(null), styleUpload = useRef<HTMLInputElement>(null), referenceRequest = useRef(0);
  useEffect(() => () => { referenceRequest.current++; }, []);
  const subjectImage = (referenceMode === "portrait" ? referenceImage : null) || additionalSubject;
  const styleImage = (referenceMode === "style" ? referenceImage : null) || additionalStyle;
  const removeReference = (role: "subject" | "style") => {
    if (referenceImage && (role === "subject" ? referenceMode === "portrait" : referenceMode === "style")) onClearReference();
    if (role === "subject") setAdditionalSubject(null); else setAdditionalStyle(null);
  };
  const loadReference = async (role: "subject" | "style", source: File | LibraryImage) => {
    const request = ++referenceRequest.current;
    setReferenceLoading(true); setReferenceError("");
    try {
      let dataUrl: string;
      if (source instanceof File) {
        if (!imageTypes.has(source.type) || !source.size || source.size > 8 * 1024 * 1024) throw Error(t("gallery.referenceFileLimit"));
        dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(Error(t("gallery.referenceReadFailed"))); reader.readAsDataURL(source); });
      } else dataUrl = await readLibraryImage(source.id);
      const reference = { title: source instanceof File ? source.name : source.title, ...await prepareImageReference(dataUrl) };
      if (request !== referenceRequest.current) return;
      removeReference(role);
      if (role === "subject") setAdditionalSubject(reference); else setAdditionalStyle(reference);
    } catch (error) { if (request === referenceRequest.current) setReferenceError(String(error)); }
    finally { if (request === referenceRequest.current) setReferenceLoading(false); }
  };
  const referenceSlot = (role: "subject" | "style", image: ImageReference | null) => <div className="min-w-0 rounded-lg border border-zinc-700 p-2">
    <p className="text-xs font-medium">{t(role === "subject" ? "gallery.subjectPhoto" : "gallery.stylePhotoReference")}</p>
    {image && <div className="my-2 flex items-center gap-2"><img src={`data:${image.mimeType};base64,${image.data}`} alt={image.title} className="h-14 w-14 rounded object-cover"/><span className="min-w-0 flex-1 truncate text-2xs" title={image.title}>{image.title}</span><button type="button" aria-label={t("gallery.removeReference")} disabled={busy || referenceLoading} onClick={() => removeReference(role)}>×</button></div>}
    <input ref={role === "subject" ? subjectUpload : styleUpload} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif" disabled={busy || referenceLoading} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void loadReference(role, file); }}/>
    <Button size="xs" disabled={busy || referenceLoading} onClick={() => (role === "subject" ? subjectUpload : styleUpload).current?.click()}>{t(image ? "gallery.replaceImage" : "gallery.addReference")}</Button>
    {role === "style" && <select aria-label={t("gallery.chooseStyleReference")} className="ui-control mt-2 w-full min-w-0 px-1 py-1 text-2xs" value="" disabled={busy || referenceLoading} onChange={event => { const image = libraryImages?.find(item => item.id === event.target.value); if (image) void loadReference("style", image); }}><option value="">{t("gallery.chooseStyleReference")}</option>{(libraryImages || []).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select>}
  </div>;
  const templates = useAppStore(state => state.settings.imagePromptTemplates) || [];
  const [templateId, setTemplateId] = useState(""), [templateName, setTemplateName] = useState("");
  const saveTemplate = (copy = false) => {
    if (!prompt.trim() || !templateName.trim()) return;
    const store = useAppStore.getState(), current = store.settings.imagePromptTemplates || [];
    const existing = !copy && current.some(item => item.id === templateId);
    if (!existing && current.length >= 100) { store.pushToast(t("aiLibrary.capacity"), "error"); return; }
    const item = { id: existing ? templateId : crypto.randomUUID(), name: templateName.trim().slice(0,80), prompt: prompt.trim().slice(0,4000) };
    store.updateSettings({ imagePromptTemplates: existing ? current.map(row => row.id === item.id ? item : row) : [...current, item] });
    setTemplateId(item.id);
    store.pushToast(t("gallery.promptSaved"), "success");
  };
  const selectedStyle = imageStylePresets.find(option => option.id === style);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} aria-labelledby="image-generation-title" onClose={onClose} className="m-auto max-h-[92vh] w-[min(560px,94vw)] overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-4 text-zinc-100 shadow-xl backdrop:bg-black/60">
    <div className="flex items-center gap-2"><h3 id="image-generation-title" className="flex-1 text-sm font-semibold">{t(provider === "muse" ? "gallery.museMediaTitle" : "gallery.generateTitle")}</h3><button type="button" disabled={busy} aria-label={t("common.close")} className="rounded px-2 py-1 text-zinc-400 hover:bg-zinc-800" onClick={() => dialog.current?.close()}>×</button></div>
    <label className="mt-3 block text-xs">{t("gallery.imageProvider")}<select value={provider} disabled={busy} onChange={event => onProviderChange(event.target.value as ImageProvider)} className="ui-control mt-1 w-full px-2 py-2">{providerOptions.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}</select></label>
    <label className="mt-3 block text-xs">{t("gallery.promptTemplates")}<select value={templateId} disabled={busy} className="ui-control mt-1 w-full px-2 py-2" onChange={event => { const item = templates.find(row => row.id === event.target.value); setTemplateId(item?.id || ""); setTemplateName(item?.name || ""); if (item) setPrompt(item.prompt); }}><option value="">{t("gallery.promptCustom")}</option>{templates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label className="mt-3 block text-xs">{t(provider === "muse" ? "gallery.museMediaPrompt" : "gallery.prompt")}<textarea autoFocus value={prompt} disabled={busy} maxLength={4000} onChange={event => setPrompt(event.target.value)} className="ui-control mt-1 min-h-24 w-full resize-y p-2" placeholder={t(provider === "muse" ? "gallery.museMediaPromptPlaceholder" : "gallery.promptPlaceholder")}/></label>
    <div className="mt-2 flex flex-wrap items-center gap-1"><input aria-label={t("gallery.promptName")} placeholder={t("gallery.promptName")} disabled={busy} maxLength={80} value={templateName} onChange={event => setTemplateName(event.target.value)} className="ui-control min-w-0 flex-1 px-2 py-1 text-xs"/><Button size="xs" disabled={busy || !prompt.trim() || !templateName.trim()} onClick={() => saveTemplate()}>{t("common.save")}</Button>{templateId && <><Button size="xs" disabled={busy || !prompt.trim() || !templateName.trim()} onClick={() => saveTemplate(true)}>{t("gallery.promptSaveNew")}</Button><Button size="xs" disabled={busy} onClick={() => { const store = useAppStore.getState(); store.updateSettings({ imagePromptTemplates: (store.settings.imagePromptTemplates || []).filter(item => item.id !== templateId) }); setTemplateId(""); }}>{t("common.delete")}</Button></>}</div>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">{referenceSlot("subject", subjectImage)}{referenceSlot("style", styleImage)}</div>
    <p className="mt-1 text-2xs text-zinc-500">{t("gallery.subjectStyleHint")}</p>
    {referenceLoading && <p role="status" className="mt-1 text-2xs">{t("gallery.loading")}</p>}
    {referenceError && <p role="alert" className="mt-1 text-xs text-rose-400">{referenceError}</p>}
    <label className="mt-3 block text-xs">{t("gallery.aspectRatio")}<select value={aspectRatio} disabled={busy} onChange={event => setAspectRatio(event.target.value as ImageAspectRatio)} className="ui-control mt-1 w-full px-2 py-2"><option value="1:1">{t("gallery.aspectSquare")}</option><option value="2:3">{t("gallery.aspectPortrait")}</option><option value="3:2">{t("gallery.aspectLandscape")}</option></select></label>
    <fieldset className="mt-3"><legend className="text-xs">{t("gallery.stylePreset")}</legend><div className="mt-1 flex flex-wrap gap-1.5"><button type="button" disabled={busy} aria-pressed={!style} onClick={() => setStyle("")} className={`rounded-full border px-2.5 py-1 text-2xs ${!style ? "border-brand bg-brand/10 text-brand" : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"}`}>{t("gallery.styleNone")}</button>{imageStylePresets.map(option => <button key={option.id} type="button" disabled={busy} aria-pressed={style === option.id} onClick={() => setStyle(current => current === option.id ? "" : option.id)} className={`rounded-full border px-2.5 py-1 text-2xs ${style === option.id ? "border-brand bg-brand/10 text-brand" : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"}`}>{t(option.label)}</button>)}</div></fieldset>
    <label className="mt-3 block text-xs">{t("gallery.exactText")}<textarea value={exactText} disabled={busy} maxLength={300} onChange={event => setExactText(event.target.value)} className="ui-control mt-1 min-h-16 w-full resize-y p-2" placeholder={t("gallery.exactTextPlaceholder")}/><span className="mt-1 block text-2xs text-zinc-500">{t("gallery.exactTextHint")}</span></label>
    <p className="mt-2 text-2xs text-zinc-500">{costHint}</p>
    {generated && (generated.mimeType.startsWith("video/") ? <video className="mt-3 max-h-[44vh] w-full rounded-lg bg-zinc-950 object-contain" src={`data:${generated.mimeType};base64,${generated.data}`} controls playsInline/> : <img className="mt-3 max-h-[44vh] w-full rounded-lg bg-zinc-950 object-contain" src={`data:${generated.mimeType};base64,${generated.data}`} alt={t("gallery.generatedPreview")}/>)}
    {error && <p role="alert" className="mt-2 break-words text-xs text-rose-400">{error}</p>}
    <div className="mt-3 flex flex-wrap justify-end gap-2">{canCollect && <Button size="sm" disabled={busy} onClick={() => onCollect(exactText)}>{t("gallery.collectMuse")}</Button>}<Button size="sm" disabled={busy} onClick={() => dialog.current?.close()}>{t("common.close")}</Button>{generated && <><Button size="sm" disabled={busy || generated.mimeType.startsWith("video/")} title={generated.mimeType.startsWith("video/") ? t("gallery.videoNotSaved") : undefined} onClick={() => onSave(prompt)}>{t("gallery.saveGenerated")}</Button><Button size="sm" disabled={busy || !canInsert} onClick={() => onInsert(prompt)}>{t("gallery.insertGenerated")}</Button></>}<Button size="sm" variant="primary" disabled={busy || referenceLoading || !canGenerate || !prompt.trim()} onClick={() => onGenerate({ prompt: prompt.trim(), aspectRatio, exactText, stylePrompt: selectedStyle?.prompt, subjectImage, styleImage })}>{busy ? t("gallery.generating") : generated ? t("gallery.generateAgain") : t("gallery.generateNow")}</Button></div>
  </dialog>;
}

function ImageLibraryPreview({ image, busy, saveError, canInsert, categories, onClose, onInsert, onSave }: { image: LibraryImage; busy: boolean; saveError: string; canInsert: boolean; categories: string[]; onClose: () => void; onInsert: (image: LibraryImage) => void; onSave: (image: LibraryImage) => void }) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState("");
  const [error, setError] = useState("");
  const [title, setTitle] = useState(image.title);
  const [category, setCategory] = useState(image.category);
  const [caption, setCaption] = useState(image.caption || "");
  useEffect(() => { dialog.current?.showModal(); let stopped = false; readLibraryImage(image.id).then(value => { if (!stopped) setData(value); }).catch(e => { if (!stopped) setError(String(e)); }); return () => { stopped = true; }; }, [image.id]);
  return <dialog ref={dialog} aria-labelledby="image-library-preview-title" onClose={onClose} className="m-auto max-h-[90vh] w-[min(600px,94vw)] overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-4 text-zinc-100 shadow-xl backdrop:bg-black/60">
    <h3 id="image-library-preview-title" className="mb-3 text-sm font-semibold">{t("quickShelf.preview")}</h3>
    {error ? <p role="alert" className="text-xs text-rose-400">{error}</p> : data ? <img src={data} alt={image.title} className="max-h-[45vh] w-full object-contain" /> : <p className="text-xs">{t("gallery.loading")}</p>}
    <p className="my-2 text-2xs text-zinc-500">{image.mime} · {(image.size / 1024 / 1024).toFixed(2)} MB</p>
    <label className="block text-xs">{t("gallery.name")}<input value={title} disabled={busy} maxLength={160} onChange={e => setTitle(e.target.value)} className="ui-control my-1 w-full px-2" /></label>
    <label className="block text-xs">{t("gallery.category")}<input value={category} disabled={busy} list="image-preview-categories" maxLength={60} onChange={e => setCategory(e.target.value)} className="ui-control my-1 w-full px-2" /></label>
    <datalist id="image-preview-categories">{categories.map(value => <option key={value} value={value} />)}</datalist>
    <label className="block text-xs">{t("gallery.caption")}<textarea value={caption} disabled={busy} maxLength={2000} onChange={e => setCaption(e.target.value)} className="ui-control my-1 w-full px-2" /></label>
    {saveError && <p role="alert" className="text-xs text-rose-400">{saveError}</p>}
    <div className="mt-3 flex justify-end gap-2"><Button size="sm" disabled={busy} onClick={onClose}>{t("common.close")}</Button><Button size="sm" disabled={busy || !title.trim()} onClick={() => onSave({ ...image, title, category, caption })}>{t("common.save")}</Button><Button size="sm" variant="primary" disabled={busy || !title.trim() || !canInsert || !data || !!error} onClick={() => onInsert({ ...image, title, category, caption })}>{t("gallery.saveInsert")}</Button></div>
  </dialog>;
}
