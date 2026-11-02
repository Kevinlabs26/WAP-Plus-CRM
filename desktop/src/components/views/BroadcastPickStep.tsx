import { useState } from "react";
import { cn, displayContactLabel } from "@/lib/utils";
import { Virtuoso } from "react-virtuoso";
import { contactSendablePhone } from "@/lib/broadcastTemplate";
import { BROADCAST_HARD_CAP } from "@/types/broadcast";
import type { Contact, SalesStage } from "@/types/crm";
import { Avatar } from "@/components/ui/Avatar";
import {
  Button,
  Input,
  Textarea,
} from "@/components/ui/primitives";
import { useI18n } from "@/i18n";

export type BroadcastRecipientSource = "contacts" | "numbers";

type Props = {
  source: BroadcastRecipientSource;
  onSourceChange: (source: BroadcastRecipientSource) => void;
  phoneText: string;
  onPhoneTextChange: (value: string) => void;
  directPhoneCount: number;
  recipientCount: number;
  stages: { id: SalesStage; label: string }[];
  stageFilter: SalesStage | "all";
  onStageFilterChange: (value: SalesStage | "all") => void;
  tagFilter: string;
  onTagFilterChange: (value: string) => void;
  q: string;
  onQChange: (value: string) => void;
  pool: Contact[];
  selectedContacts: Contact[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onSelectVisible: () => void;
  onClear: () => void;
};

/** 群发名单：粘贴号码或按需打开联系人列表。 */
export function BroadcastPickStep({
  source,
  onSourceChange,
  phoneText,
  onPhoneTextChange,
  directPhoneCount,
  recipientCount,
  stages,
  stageFilter,
  onStageFilterChange,
  tagFilter,
  onTagFilterChange,
  q,
  onQChange,
  pool,
  selectedContacts,
  selected,
  onToggle,
  onSelectVisible,
  onClear,
}: Props) {
  const { t } = useI18n();
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const selectedOnlyActive = showSelectedOnly && selected.size > 0;
  const visiblePool = selectedOnlyActive ? selectedContacts : pool;

  return (
    <div className="flex h-full min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant={source === "numbers" ? "secondary" : "ghost"} aria-pressed={source === "numbers"} onClick={() => onSourceChange("numbers")}>
          {t("broadcast.directPhones")} · {directPhoneCount}
        </Button>
        <Button variant={source === "contacts" ? "secondary" : "ghost"} aria-pressed={source === "contacts"} onClick={() => onSourceChange("contacts")}>
          {t("broadcast.chooseContacts")} · {selected.size}
        </Button>
        <span className="ml-auto text-2xs text-zinc-500" role="status">{t("broadcast.recipientTotal", { count: recipientCount, cap: BROADCAST_HARD_CAP })}</span>
      </div>
      {source === "numbers" && <section
        className={cn(
          "flex flex-1 flex-col rounded-xl border p-3",
          directPhoneCount
            ? "border-brand/30 bg-brand/5"
            : "border-zinc-800 bg-zinc-900/30"
        )}
      >
        <p className="mt-1 text-2xs text-zinc-500">
          {t("broadcast.directPhonesHint")}
        </p>
        <Textarea
          aria-label={t("broadcast.directPhones")}
          value={phoneText}
          onChange={(event) => onPhoneTextChange(event.target.value)}
          rows={12}
          spellCheck={false}
          className="mt-3 min-h-80 flex-1 overflow-y-auto font-mono"
          placeholder={"+12025550123\n+12025550124"}
        />
        <p className="mt-2 text-2xs text-zinc-500">
          {t("broadcast.validNumbers", { count: directPhoneCount })}
        </p>
      </section>}

      {source === "contacts" && <section className="flex flex-1 flex-col rounded-xl border border-zinc-800 bg-zinc-900/30 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-2xs text-zinc-500">
            {t("broadcast.stage")}
            <select
              value={stageFilter}
              onChange={(e) =>
                onStageFilterChange(e.target.value as SalesStage | "all")
              }
              className="ui-control mt-1 h-8 px-2 text-[12px]"
            >
              <option value="all">{t("broadcast.allStages")}</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-2xs text-zinc-500">
            {t("broadcast.tagContains")}
            <Input
              value={tagFilter}
              onChange={(e) => onTagFilterChange(e.target.value)}
              className="mt-1 h-8 w-28"
              placeholder={t("broadcast.optional")}
            />
          </label>
          <label className="min-w-[10rem] flex-1 text-2xs text-zinc-500">
            {t("broadcast.search")}
            <Input
              value={q}
              onChange={(e) => onQChange(e.target.value)}
              className="mt-1 h-8"
              placeholder={t("broadcast.searchContacts")}
            />
          </label>
          <Button
            variant="secondary"
            className="!min-h-8 !px-2 text-2xs"
            onClick={onSelectVisible}
          >
            {t("crm.selectAll")}
          </Button>
          <Button
            variant="ghost"
            className="!min-h-8 !px-2 text-2xs"
            disabled={!selected.size}
            onClick={() => {
              onClear();
              setShowSelectedOnly(false);
            }}
          >
            {t("broadcast.clearSelection")}
          </Button>
          <Button
            variant={selectedOnlyActive ? "secondary" : "ghost"}
            className="!min-h-8 !px-2 text-2xs"
            disabled={!selected.size}
            onClick={() => setShowSelectedOnly((current) => !current)}
          >
            {selectedOnlyActive ? t("broadcast.viewAll") : t("broadcast.selectedOnly")}
          </Button>
        </div>
        <p className="mt-2 text-2xs text-zinc-600">
          {t("broadcast.selectionSummary", {
            visible: visiblePool.length,
          })}
        </p>
        {visiblePool.length ? (
          <Virtuoso
            className="mt-2"
            style={{ height: "clamp(360px, 56vh, 640px)" }}
            data={visiblePool}
            computeItemKey={(_index, contact) => contact.id}
            defaultItemHeight={45}
            increaseViewportBy={90}
            itemContent={(_index, c) => {
              const phone = contactSendablePhone(c);
              const label = displayContactLabel(
                c.name,
                c.phone,
                c.channelAddress,
                "",
                { isGroup: false }
              );
              const hasName = Boolean(
                label && label !== phone && label !== "未备注联系人"
              );
              const displayName = hasName ? label : phone || t("broadcast.unknownContact");
              const on = selected.has(c.id);
              return (
                <div className="pb-1">
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 text-[12px]",
                      on
                        ? "border-brand/40 bg-brand/10"
                        : "border-zinc-800/80 bg-zinc-950/50",
                      !phone && "opacity-50"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={!phone}
                      onChange={() => onToggle(c.id)}
                    />
                    <Avatar
                      name={displayName}
                      seed={phone || c.id}
                      src={c.avatarUrl || c.avatarFullUrl}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-zinc-200">
                        {displayName}
                      </span>
                      <span className="block truncate text-2xs text-zinc-500">
                        {hasName ? phone : c.company || t("broadcast.noWhatsAppName")}
                      </span>
                    </span>
                  </label>
                </div>
              );
            }}
          />
        ) : (
          <div className="py-8 text-center text-2xs text-zinc-600">
            {selectedOnlyActive ? t("broadcast.noSelectedContacts") : t("crm.noMatch")}
          </div>
        )}
      </section>}

    </div>
  );
}
