import { useEffect, useRef, useState } from "react";
import { Button, Input } from "@/components/ui/primitives";
import { useI18n } from "@/i18n";
import { clearQuickMedia, listQuickMedia, QUICK_MEDIA_CHANGED, removeQuickMediaBatch, type QuickMedia } from "@/lib/quickMediaLibrary";
import { useAppStore } from "@/store/appStore";

export function QuickMediaManager() {
  const { t } = useI18n();
  const [items, setItems] = useState<QuickMedia[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | QuickMedia["kind"]>("all");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");
  const needle = query.trim().toLocaleLowerCase();
  const visible = items.filter(item => (kind === "all" || item.kind === kind) && item.title.toLocaleLowerCase().includes(needle));
  const allSelected = visible.length > 0 && visible.every(item => selected.has(item.id));

  useEffect(() => {
    let active = true;
    let revision = 0;
    const refresh = () => {
      const token = ++revision;
      void listQuickMedia().then(next => {
        if (!active || token !== revision) return;
        setItems(next);
        const existing = new Set(next.map(item => item.id));
        setSelected(current => new Set([...current].filter(id => existing.has(id))));
      }).catch(error => { if (active && token === revision) setError(String(error)); });
    };
    refresh();
    window.addEventListener(QUICK_MEDIA_CHANGED, refresh);
    return () => { active = false; window.removeEventListener(QUICK_MEDIA_CHANGED, refresh); };
  }, []);

  async function remove(clearAll: boolean) {
    const ids = [...selected];
    const count = clearAll ? items.length : ids.length;
    if (!count || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const store = useAppStore.getState();
      if (!await store.requestConfirm({
        title: t(clearAll ? "quickMedia.clearLocal" : "quickMedia.deleteSelected"),
        description: t(clearAll ? "quickMedia.confirmClear" : "quickMedia.confirmDelete", { count }),
        confirmLabel: t("common.delete"), cancelLabel: t("common.cancel"), tone: "danger",
      })) return;
      if (clearAll) await clearQuickMedia();
      else await removeQuickMediaBatch(ids);
      setSelected(new Set());
    } catch (error) { setError(String(error)); }
    finally { pending.current = false; setBusy(false); }
  }

  return <section className="flex min-h-0 flex-1 flex-col gap-2 p-2" aria-label={t("quickMedia.audioVideo")}>
    <div className="flex gap-2">
      <Input value={query} onChange={event => setQuery(event.target.value)} aria-label={t("quickMedia.search")} placeholder={t("quickMedia.search")} className="min-w-0 flex-1" />
      <select className="ui-control px-2 text-xs" aria-label={t("quickMedia.filter")} value={kind}
        onChange={event => setKind(event.target.value as typeof kind)}>
        {(["all", "audio", "video"] as const).map(option => <option key={option} value={option}>{t(`quickMedia.${option}`)}</option>)}
      </select>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1 text-xs">
        <input type="checkbox" checked={allSelected} disabled={!visible.length || busy} onChange={() => setSelected(current => {
          const next = new Set(current);
          for (const item of visible) if (allSelected) next.delete(item.id); else next.add(item.id);
          return next;
        })} />
        {t("quickMedia.selectVisible")}
      </label>
      <Button size="xs" disabled={!selected.size || busy} onClick={() => void remove(false)}>
        {t("quickMedia.deleteSelected")} ({selected.size})
      </Button>
      <Button size="xs" disabled={!items.length || busy} onClick={() => void remove(true)}>{t("quickMedia.clearLocal")}</Button>
    </div>
    {error && <p role="alert" className="break-words text-xs text-rose-400">{error}</p>}
    {!visible.length && <p className="text-xs text-zinc-500">{t("quickMedia.empty")}</p>}
    <ul className="min-h-0 flex-1 divide-y divide-zinc-800 overflow-y-auto">
      {visible.map(item => <li key={item.id}>
        <label className="flex items-center gap-2 px-1 py-2">
          <input type="checkbox" checked={selected.has(item.id)} disabled={busy} onChange={event => {
            const checked = event.target.checked;
            setSelected(current => {
              const next = new Set(current);
              if (checked) next.add(item.id); else next.delete(item.id);
              return next;
            });
          }} />
          <span className="min-w-0 flex-1 truncate text-xs" title={item.title}>{item.title}</span>
          <span className="shrink-0 text-[11px] text-zinc-500">{t(`quickMedia.${item.kind}`)}</span>
        </label>
      </li>)}
    </ul>
  </section>;
}
