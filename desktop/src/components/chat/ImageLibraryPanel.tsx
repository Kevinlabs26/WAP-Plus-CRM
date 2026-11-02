import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Plus, Star } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/primitives";
import { useDetailsMenu } from "@/components/ui/useDetailsMenu";
import { useI18n } from "@/i18n";
import { useAppStore } from "@/store/appStore";
import { isTauri } from "@/lib/bridge";
import { addLibraryImage, createLibraryCategory, deleteLibraryCategory, deleteLibraryImages, editLibraryImage, exportImageLibrary, filterLibraryImages, listLibraryCategories, listLibraryImages, readLibraryImage, restoreImageLibrary, type LibraryImage } from "@/lib/imageLibrary";
import { emitQuickReplyMedia } from "@/lib/quickReplyMedia";

const PAGE_SIZE = 40;
export function ImageLibraryPanel({ chatId, contextKey }: { chatId?: string | null; contextKey: string }) {
  const { t } = useI18n();
  const [images, setImages] = useState<LibraryImage[]>([]);
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("*");
  const [destination, setDestination] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [view, setView] = useState<"all" | "pinned" | "recent">("all");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [preview, setPreview] = useState<LibraryImage | null>(null);
  const upload = useRef<HTMLInputElement>(null);
  const restore = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const menuRef = useDetailsMenu(contextKey);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const context = useRef(contextKey); context.current = contextKey;
  const pushToast = useAppStore(state => state.pushToast);
  const requestConfirm = useAppStore(state => state.requestConfirm);
  const categories = useMemo(() => [...new Set([...customCategories, ...images.map(image => image.category).filter(Boolean)])].sort(), [customCategories, images]);
  const filtered = useMemo(() => filterLibraryImages(images, query, category, view), [images, query, category, view]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const chosen = selected.flatMap(id => { const image = images.find(item => item.id === id); return image ? [image] : []; });
  useEffect(() => { setPreview(null); }, [contextKey]);
  useEffect(() => {
    let stopped = false, generation = 0;
    const load = async () => {
      const request = ++generation;
      try { const [rows, names] = await Promise.all([listLibraryImages(), listLibraryCategories()]); if (!stopped && request === generation) { setImages(rows); setCustomCategories(names); setSelected(ids => ids.filter(id => rows.some(row => row.id === id))); } }
      catch (e) { if (!stopped) setError(String(e)); }
      finally { if (!stopped) setLoading(false); }
    };
    if (isTauri()) void load(); else setLoading(false);
    window.addEventListener("wap:image-library", load);
    return () => { stopped = true; window.removeEventListener("wap:image-library", load); };
  }, []);
  useEffect(() => { setPage(0); }, [query, category, view]);

  const run = async (work: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setProgress("");
    try { await work(); }
    catch (e) { setError(String(e)); }
    finally { lock.current = false; setBusy(false); window.dispatchEvent(new Event("wap:image-library")); }
  };
  const removeCategory = (name: string) => run(async () => {
    if (!name || name === "*" || !await requestConfirm({ title: t("gallery.deleteCategoryConfirm", { name }), description: t("gallery.deleteCategoryHint"), tone: "danger" })) return;
    await deleteLibraryCategory(name);
    setImages(rows => rows.map(image => image.category === name ? { ...image, category: "" } : image));
    setCustomCategories(names => names.filter(value => value !== name));
    setCategory(value => value === name ? "*" : value);
    setDestination(value => value.trim() === name ? "" : value);
  });
  const importFiles = (files: (File | string)[]) => run(async () => {
    let added = 0, duplicates = 0, failures = 0, detail = "";
    if (files.length > 3000) throw new Error(t("gallery.tooMany"));
    for (let index = 0; index < files.length; index++) {
      const source = files[index]!;
      try {
        let file: File;
        if (typeof source === "string") {
          const dropped = await invoke<{ name: string; mime: string; bytes: number[] }>("read_dropped_file", { path: source });
          file = new File([new Uint8Array(dropped.bytes)], dropped.name, { type: dropped.mime });
        } else file = source;
        const result = await addLibraryImage(file, category === "*" ? "" : category); if (result.added) added++; else duplicates++;
      }
      catch (e) { failures++; detail = `${typeof source === "string" ? source.split(/[\\/]/).pop() : source.name}: ${String(e)}`; }
      setProgress(`${index + 1}/${files.length}`);
    }
    setProgress(t("gallery.importResult", { added, duplicates, failures }));
    if (failures) setError(detail);
  });
  const importRef = useRef(importFiles); importRef.current = importFiles;
  useEffect(() => {
    const drop = (event: Event) => { const paths = (event as CustomEvent<unknown>).detail; if (Array.isArray(paths) && paths.every(path => typeof path === "string")) void importRef.current(paths); };
    window.addEventListener("wap:image-library-drop", drop);
    return () => window.removeEventListener("wap:image-library-drop", drop);
  }, []);
  // shortcut: batch captions apply to the first image; extend when the composer supports per-image captions.
  const insert = async (items: LibraryImage[], caption = items[0]?.caption || "", saveEdits = false) => {
    if (!chatId || !items.length) return;
    if (items.length > 5) { setError(t("gallery.sendLimit")); return; }
    const captured = contextKey;
    await run(async () => {
      if (saveEdits) await editLibraryImage(items[0]!);
      const media = [];
      for (const image of items) media.push({ dataUrl: await readLibraryImage(image.id), fileName: image.title + (image.title.includes(".") ? "" : `.${image.mime.split("/")[1]}`), mimeType: image.mime, kind: "image" as const });
      if (!mounted.current || captured !== context.current || useAppStore.getState().selectedChatId !== chatId) throw new Error(t("gallery.chatChanged"));
      const [first, ...additionalMedia] = media;
      if (!first || !emitQuickReplyMedia({ ...first, additionalMedia, caption, token: crypto.randomUUID(), target: "main", chatId })) throw new Error(t("quickShelf.insertUnavailable"));
      setPreview(null); setSelected([]); pushToast(t("quickShelf.mediaInserted"), "success");
      for (const image of items) await editLibraryImage({ ...image, usedAt: Date.now() });
    });
  };
  if (!isTauri()) return <p className="p-4 text-xs text-zinc-500">{t("gallery.desktopOnly")}</p>;
  return <section data-image-library-drop className="flex min-h-0 flex-1 flex-col" aria-label={t("gallery.title")} onDragOver={e => { e.preventDefault(); e.stopPropagation(); }} onDrop={e => { e.preventDefault(); e.stopPropagation(); if (!lock.current) void importFiles(Array.from(e.dataTransfer.files)); }}>
    <header className="shrink-0 space-y-2 border-b border-zinc-800 p-2">
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 text-xs font-semibold">{t("gallery.title")} <span className="ml-1 font-normal text-zinc-500">{images.length}</span></h3>
        <button type="button" className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-brand" aria-label={t("gallery.add")} title={t("gallery.add")} disabled={busy || loading} onClick={() => upload.current?.click()}><ImagePlus aria-hidden="true" className="h-4 w-4" /></button>
        <details ref={menuRef} className="relative text-xs text-zinc-500" onClick={event => { if ((event.target as HTMLElement).closest("button")) event.currentTarget.open = false; }}>
          <summary aria-label={t("gallery.more")} title={t("gallery.more")} className="cursor-pointer list-none rounded p-1.5 hover:bg-zinc-800">•••</summary>
          <div className="absolute right-0 top-full z-10 mt-1 flex min-w-max flex-col gap-1 rounded-lg border border-zinc-700 bg-zinc-900 p-1 shadow-xl">
            <div className="flex gap-1">{(["all", "pinned", "recent"] as const).map(value => <Button key={value} size="xs" variant={view === value ? "secondary" : "ghost"} aria-pressed={view === value} onClick={() => setView(value)}>{t(`quickShelf.view.${value}`)}</Button>)}</div>
            <Button size="xs" disabled={busy} onClick={() => { setSelecting(value => !value); setSelected([]); }}>{t(selecting ? "common.close" : "gallery.multiSelect")}</Button>
            {category !== "*" && !!category && <Button size="xs" className="text-rose-400" disabled={busy || loading} onClick={() => void removeCategory(category)}>{t("gallery.deleteCategory")}</Button>}
            <Button size="xs" disabled={busy || loading || !images.length && !categories.length} onClick={() => void run(async () => { await exportImageLibrary(chosen.length ? chosen : images, chosen.length ? [...new Set(chosen.map(image => image.category).filter(Boolean))] : categories); setProgress(t("gallery.exported")); })}>{t("gallery.backup")}</Button>
            <Button size="xs" disabled={busy || loading} onClick={() => restore.current?.click()}>{t("gallery.restore")}</Button>
            {!!chosen.length && <Button size="xs" className="text-rose-400" disabled={busy} onClick={() => void run(async () => { if (await requestConfirm({ title: t("gallery.deleteConfirm", { count: chosen.length }), tone: "danger" })) { await deleteLibraryImages(chosen.map(image => image.id)); setSelected([]); } })}>{t("common.delete")}</Button>}
          </div>
        </details>
      </div>
      <input ref={upload} type="file" hidden multiple accept="image/png,image/jpeg,image/gif,image/webp" onChange={e => { const files = Array.from(e.currentTarget.files || []); e.currentTarget.value = ""; void importFiles(files); }} />
      <input ref={restore} type="file" hidden accept="application/json,.json" onChange={e => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (file) void run(async () => { const added = await restoreImageLibrary(file, (done, total) => setProgress(`${done}/${total}`)); setProgress(t("gallery.restored", { count: added })); }); }} />

      <input className="ui-control h-8 w-full px-2 text-xs" aria-label={t("gallery.search")} placeholder={t("gallery.search")} value={query} onChange={e => setQuery(e.target.value)} />
      <nav className="flex items-center gap-1" aria-label={t("gallery.category")}>
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {[["*", t("multi.all")], ...(images.some(image => !image.category) ? [["", t("gallery.uncategorized")]] : []), ...categories.map(name => [name, name])].map(([value, label]) => <button type="button" key={value} disabled={busy} aria-pressed={category === value} onClick={() => setCategory(value!)} onContextMenu={value && value !== "*" ? event => { event.preventDefault(); void removeCategory(value); } : undefined} className={`shrink-0 max-w-40 truncate rounded-full px-2.5 py-1 text-2xs ${category === value ? "bg-brand/10 text-brand" : "text-zinc-500 hover:bg-zinc-800"}`} title={label}>{label}</button>)}
        </div>
        <button type="button" aria-label={t("gallery.createCategory")} title={t("gallery.createCategory")} aria-expanded={creatingCategory} className="shrink-0 rounded px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-800" onClick={() => { setCreatingCategory(value => !value); setDestination(""); }}>＋</button>
      </nav>
      {(creatingCategory || !!chosen.length) && <>
      <form className="flex gap-1" onSubmit={event => {
          event.preventDefault();
          const name = destination.trim();
          if (!name) return;
          void run(async () => {
            if (!categories.includes(name)) {
              await createLibraryCategory(name);
              setCustomCategories(values => [...new Set([...values, name])]);
            }
            if (chosen.length) {
              for (const image of chosen) await editLibraryImage({ ...image, category: name });
              setSelected([]);
            }
            setCreatingCategory(false); setCategory(name); setDestination(""); setQuery(""); setView("all");
          });
        }}>
          <input autoFocus aria-label={t("gallery.categoryName")} placeholder={t("gallery.categoryName")} list="image-library-categories" value={destination} maxLength={60} onChange={event => setDestination(event.target.value)} className="ui-control h-8 min-w-0 flex-1 px-2 text-xs" />
          <Button type="submit" size="xs" disabled={busy || loading || !destination.trim() || !chosen.length && categories.includes(destination.trim())}>{t(chosen.length ? "gallery.move" : "gallery.createCategory")}</Button>
        </form>
      <datalist id="image-library-categories">{categories.map(value => <option key={value} value={value} />)}</datalist></>}
      {view !== "all" && <button type="button" className="text-2xs text-brand" onClick={() => setView("all")}>{t(`quickShelf.view.${view}`)} ×</button>}
    </header>
    {(error || progress || loading) && <div aria-live="polite" className="shrink-0 break-words p-2 text-2xs">{loading && <p>{t("gallery.loading")}</p>}{progress && <p className="text-zinc-400">{progress}</p>}{error && <p role="alert" className="text-rose-400">{error}</p>}</div>}
    <div className="min-h-0 flex-1 overflow-y-auto p-2" aria-busy={busy}>
      <div className="grid grid-cols-2 gap-2">{visible.map(image => <article key={image.id} className={`relative min-w-0 rounded-lg p-1.5 ${selected.includes(image.id) ? "ring-1 ring-brand bg-brand/10" : ""}`}>
        <div className="absolute inset-x-3 top-3 z-[1] flex justify-between gap-1">{selecting && <input type="checkbox" disabled={busy} aria-label={t("gallery.selectNamed", { title: image.title })} checked={selected.includes(image.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, image.id] : ids.filter(id => id !== image.id))} />}<button type="button" className="ml-auto rounded-full bg-zinc-900 p-1 shadow-sm" disabled={busy} aria-label={t(image.pinned ? "quickShelf.unpin" : "quickShelf.pin", { title: image.title })} aria-pressed={image.pinned} onClick={() => void run(async () => editLibraryImage({ ...image, pinned: !image.pinned }))}><Star className={`h-3.5 w-3.5 ${image.pinned ? "fill-amber-400 text-amber-400" : "text-zinc-500"}`} /></button></div>
        <button type="button" disabled={busy} className="block w-full rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand" onClick={() => { setError(""); setPreview(image); }} aria-label={t("quickShelf.previewNamed", { title: image.title })}><img src={image.thumbnail} alt={image.title} loading="lazy" decoding="async" className="aspect-square w-full rounded-lg bg-zinc-800 object-contain" /><span className="mt-1 block truncate text-left text-2xs" title={image.title}>{image.title}</span></button>
        {!selecting && <button type="button" className="absolute bottom-8 right-3 flex h-7 w-7 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 p-0 text-brand shadow-sm" aria-label={t("quickShelf.insert")} title={t("quickShelf.insert")} disabled={busy || !chatId} onClick={() => void insert([image])}><Plus aria-hidden="true" className="h-4 w-4 shrink-0" /></button>}
      </article>)}</div>
      {!loading && !visible.length && <p className="p-5 text-center text-xs text-zinc-500">{t(!query.trim() && category !== "*" && view === "all" ? "gallery.emptyCategory" : images.length ? "gallery.noMatches" : "gallery.empty")}</p>}
    </div>
    {(selecting || filtered.length > PAGE_SIZE) && <footer className="shrink-0 space-y-2 border-t border-zinc-800 p-2">
      {selecting && <div className="flex items-center gap-2 text-2xs">
        <button type="button" className="text-zinc-500 hover:text-zinc-300" disabled={busy || !visible.length} onClick={() => setSelected(ids => [...new Set([...ids, ...visible.map(image => image.id)])])}>{t("gallery.selectPage")}</button>
        <span className="min-w-0 flex-1 text-right text-zinc-500">{chosen.length ? t("gallery.selected", { count: chosen.length }) : ""}</span>
        <button type="button" className="text-zinc-500 hover:text-zinc-300" disabled={busy} onClick={() => { setSelected([]); setSelecting(false); }}>{t("common.close")}</button>
      </div>}
      {!!chosen.length && <div className="flex flex-wrap gap-1">
        <Button size="xs" disabled={busy || !chatId || chosen.length > 5} onClick={() => void insert(chosen)}>{t("gallery.insertSelected")}</Button>
      </div>}
      {filtered.length > PAGE_SIZE && <div className="flex items-center justify-between text-2xs text-zinc-500"><Button size="xs" aria-label={t("quickShelf.previousPage")} disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>‹</Button><span>{currentPage + 1}/{Math.ceil(filtered.length / PAGE_SIZE)}</span><Button size="xs" aria-label={t("quickShelf.nextPage")} disabled={(currentPage + 1) * PAGE_SIZE >= filtered.length} onClick={() => setPage(currentPage + 1)}>›</Button></div>}
    </footer>}
    {preview && <ImageLibraryPreview key={`${contextKey}:${preview.id}`} image={preview} busy={busy} saveError={error} canInsert={!!chatId} categories={categories} onClose={() => setPreview(null)} onInsert={image => void insert([image], image.caption, true)} onSave={image => void run(async () => { await editLibraryImage(image); setPreview(null); })} />}
  </section>;
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
