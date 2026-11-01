import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

export type SavedMessageFilter =
  | "all"
  | "text"
  | "image"
  | "video"
  | "audio"
  | "file"
  | "tag";

type Props = {
  filter: SavedMessageFilter;
  onFilterChange: (filter: SavedMessageFilter) => void;
  tagFilter: string;
  onTagFilterChange: (value: string) => void;
  tags: string[];
  selectMode: boolean;
  selectedCount: number;
  onToggleSelectMode: () => void;
  onSelectAll: () => void;
  onPinSelected: () => void;
  onDeleteSelected: () => void;
};

export function SavedMessageToolbar({
  filter,
  onFilterChange,
  tagFilter,
  onTagFilterChange,
  tags,
  selectMode,
  selectedCount,
  onToggleSelectMode,
  onSelectAll,
  onPinSelected,
  onDeleteSelected,
}: Props) {
  const { t } = useI18n();
  const filterLabels = {
    all: t("saved.all"), text: t("saved.text"), image: t("saved.image"),
    video: t("saved.video"), audio: t("saved.audio"), file: t("saved.file"), tag: t("saved.tag"),
  } as const;
  return (
    <div className="shrink-0 border-b border-zinc-800/70">
      <div className="flex flex-wrap items-center gap-2 px-4 py-1.5">
        <select value={filter} onChange={event => onFilterChange(event.target.value as SavedMessageFilter)} aria-label={t("saved.filterType")} className="ui-control min-w-0 max-w-40 px-2 text-2xs">
          {(Object.keys(filterLabels) as SavedMessageFilter[]).map(id => <option key={id} value={id}>{filterLabels[id]}</option>)}
        </select>
        {filter === "tag" && (
          <select
            value={tagFilter}
            aria-label={t("saved.tag")}
            onChange={(event) => onTagFilterChange(event.target.value)}
            className="ui-control min-w-0 max-w-40 px-2 text-2xs"
          >
            <option value="all">{t("saved.allTags")}</option>
            {tags.map((tag) => (
              <option key={tag} value={tag}>{tag}</option>
            ))}
          </select>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={onToggleSelectMode}
          className={cn(
            "shrink-0 rounded-md px-2 py-1 text-2xs transition-colors",
            selectMode
              ? "bg-brand/15 text-brand"
              : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          )}
        >
          {selectMode ? t("saved.done") : t("saved.multiSelect")}
        </button>
      </div>
      {selectMode && (
        <div className="flex flex-wrap items-center gap-3 border-t border-zinc-800/70 px-4 py-1.5 text-2xs">
          <span className="text-zinc-500">{t("saved.selected", { count: selectedCount })}</span>
          <button
            type="button"
            className="text-zinc-400 hover:text-zinc-100"
            onClick={onSelectAll}
          >
            {t("saved.selectAll")}
          </button>
          <button
            type="button"
            disabled={!selectedCount}
            className="text-brand disabled:opacity-35"
            onClick={onPinSelected}
          >
            {t("saved.pin")}
          </button>
          <button
            type="button"
            disabled={!selectedCount}
            className="text-rose-300 disabled:opacity-35"
            onClick={onDeleteSelected}
          >
            {t("saved.delete")}
          </button>
        </div>
      )}
    </div>
  );
}
