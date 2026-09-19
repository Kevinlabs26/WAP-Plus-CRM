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
    <div className="flex items-center gap-1 overflow-x-auto border-b border-zinc-800/70 px-4 py-1.5">
      {([
        ["all", "全部"],
        ["text", "文字"],
        ["image", "图片"],
        ["video", "视频"],
        ["audio", "语音"],
        ["file", "文件"],
        ["tag", "标签"],
      ] as const).map(([id]) => (
        <button
          key={id}
          type="button"
          onClick={() => onFilterChange(id)}
          className={cn(
            "shrink-0 rounded-md px-2 py-1 text-2xs transition-colors",
            filter === id
              ? "bg-brand/15 text-brand"
              : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          )}
        >
          {filterLabels[id]}
        </button>
      ))}
      {filter === "tag" && (
        <select
          value={tagFilter}
          onChange={(event) => onTagFilterChange(event.target.value)}
          className="h-6 rounded-md border border-zinc-800 bg-zinc-900 px-1.5 text-2xs text-zinc-400 outline-none focus:border-brand/50"
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
      {selectMode && (
        <div className="flex items-center gap-2 border-b border-zinc-800/70 px-4 py-1.5 text-2xs">
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
