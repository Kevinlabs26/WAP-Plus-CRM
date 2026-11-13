import { useMemo, useState } from "react";
import { FolderPlus, Search, Trash2 } from "lucide-react";
import type { ChatPreview } from "@/types/crm";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

type FolderTarget = { id: string; name: string };

type Props = {
  mode: "move" | "delete";
  folderName: string;
  chats: ChatPreview[];
  folders?: FolderTarget[];
  onClose: () => void;
  onConfirm: (chatIds: string[], targetFolderId: string | null) => void;
};

export function FolderBatchActionDialog({
  mode,
  folderName,
  chats,
  folders = [],
  onClose,
  onConfirm,
}: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [targetFolderId, setTargetFolderId] = useState(folders[0]?.id || "");
  const needle = query.trim().toLocaleLowerCase();
  const visibleChats = useMemo(
    () => chats.filter(chat => !needle || (chat.contactName || chat.id).toLocaleLowerCase().includes(needle)),
    [chats, needle]
  );

  const toggleVisible = () => setSelected(current => {
    const next = new Set(current);
    const allSelected = visibleChats.every(chat => next.has(chat.id));
    visibleChats.forEach(chat => allSelected ? next.delete(chat.id) : next.add(chat.id));
    return next;
  });

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/65 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-zinc-700/90 bg-zinc-900 shadow-2xl shadow-black/50"
        onClick={event => event.stopPropagation()}
        onKeyDown={event => { if (event.key === "Escape") onClose(); }}
      >
        <div className="shrink-0 border-b border-zinc-800 px-5 py-4">
          <h3 className="text-[15px] font-semibold text-zinc-100">
            {t(mode === "move" ? "folder.batchMoveTitle" : "folder.batchDeleteTitle", { name: folderName })}
          </h3>
          <p className="mt-1 text-[11px] leading-4 text-zinc-500">
            {t(mode === "move" ? "folder.batchActionHint" : "folder.batchDeleteHint")}
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {mode === "move" && (
            <label className="block text-[11px] text-zinc-500">
              {t("folder.batchTarget")}
              <select
                className="ui-control mt-1 h-9 w-full px-3 text-[12px]"
                value={targetFolderId}
                onChange={event => setTargetFolderId(event.target.value)}
              >
                <option value="">{t("folder.ungrouped")}</option>
                {folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
              </select>
            </label>
          )}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={t("folder.batchSearch")}
              className="ui-control h-9 w-full pl-9 pr-3 text-[12px]"
            />
          </div>
          {visibleChats.length > 0 && (
            <button type="button" className="text-[11px] text-brand hover:underline" onClick={toggleVisible}>
              {visibleChats.every(chat => selected.has(chat.id)) ? t("folder.batchClearVisible") : t("folder.batchSelectVisible")}
            </button>
          )}
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {visibleChats.map(chat => {
              const checked = selected.has(chat.id);
              return (
                <label key={chat.id} className={cn("flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-zinc-800", checked && "bg-brand/10")}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => setSelected(current => {
                      const next = new Set(current);
                      if (next.has(chat.id)) next.delete(chat.id); else next.add(chat.id);
                      return next;
                    })}
                    className="h-4 w-4 shrink-0 accent-[var(--brand)]"
                  />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-200">{chat.contactName || chat.id}</span>
                </label>
              );
            })}
            {visibleChats.length === 0 && (
              <div className="py-8 text-center text-[12px] text-zinc-500">
                {chats.length ? t("folder.batchNoMatches") : t("folder.batchNoChats")}
              </div>
            )}
          </div>
          {mode === "delete" && <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2.5 text-[12px] leading-5 text-zinc-300">{t("folder.batchDeleteWarning")}</div>}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-zinc-800 bg-zinc-950/40 px-5 py-3">
          <span className="text-[11px] text-zinc-500">{t("folder.batchSelectedCount", { count: selected.size })}</span>
          <div className="flex gap-2">
            <button type="button" className="rounded-lg px-3 py-1.5 text-[12px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200" onClick={onClose}>{t("dialog.cancel")}</button>
            <button
              type="button"
              className={cn("inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12px] font-medium text-[var(--brand-foreground)] hover:brightness-110 disabled:opacity-40", mode === "delete" ? "border border-rose-500/40 bg-rose-500/15 text-rose-200" : "bg-brand")}
              disabled={!selected.size}
              onClick={() => onConfirm([...selected], mode === "move" ? targetFolderId || null : null)}
            >
              {mode === "move" ? <><FolderPlus className="h-3.5 w-3.5" />{t("folder.batchMoveConfirm", { count: selected.size })}</> : <><Trash2 className="h-3.5 w-3.5" />{t("folder.batchDeleteConfirm", { count: selected.size })}</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
