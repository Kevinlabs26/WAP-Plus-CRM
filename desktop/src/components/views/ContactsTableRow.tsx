import { MessageSquare } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { useAppStore } from "@/store/appStore";
import type { EnrichedContactRow } from "@/lib/contactsTableQuery";
import type { SalesStage } from "@/types/crm";
import { useI18n } from "@/i18n";

export const CONTACTS_TABLE_GRID =
  "grid-cols-[36px_minmax(180px,1.5fr)_145px_130px_120px_minmax(120px,1fr)_150px_56px]";

interface ContactsTableRowProps {
  row: EnrichedContactRow;
  selected: boolean;
  accountLabel: string;
  stages: Array<{ id: SalesStage; label: string }>;
  disabled: boolean;
  onToggleSelect: (contactId: string) => void;
}

function formatShortDate(iso?: string): string {
  if (!iso) return "—";
  return iso.length >= 10 ? iso.slice(0, 10) : iso;
}

/** Single virtualized row in ContactsView with inline name and stage editing. */
export function ContactsTableRow({
  row,
  selected,
  accountLabel,
  stages,
  disabled,
  onToggleSelect,
}: ContactsTableRowProps) {
  const { t } = useI18n();
  const { contact } = row;

  return (
    <div
      className={`grid ${CONTACTS_TABLE_GRID} items-center gap-3 border-b border-zinc-800/50 px-6 py-2.5 text-[12px] hover:bg-zinc-900/50`}
    >
      <input
        type="checkbox"
        disabled={disabled}
        aria-label={t("contactManage.select", { name: contact.name || contact.phone })}
        checked={selected}
        onChange={() => onToggleSelect(contact.id)}
      />
      <div className="flex min-w-0 items-center gap-2">
        <Avatar name={contact.name || contact.phone} seed={contact.phone || contact.id} src={contact.avatarUrl || contact.avatarFullUrl} size="sm" />
        <div className="min-w-0 flex-1">
          <input
            key={`${contact.id}:${contact.name}`}
            defaultValue={contact.name}
            maxLength={100}
            disabled={disabled}
            aria-label={t("contact.name")}
            className="w-full truncate rounded bg-transparent px-1 py-0.5 text-[13px] font-medium text-zinc-100 outline-none focus:bg-zinc-900 focus:ring-1 focus:ring-brand"
            onBlur={(event) => {
              const nextName = event.target.value.trim();
              if (nextName && nextName !== contact.name) {
                useAppStore.getState().updateContact(contact.id, { name: nextName });
              } else {
                event.target.value = contact.name;
              }
            }}
          />
          {contact.company && (
            <div className="truncate px-1 text-[11px] text-zinc-500">{contact.company}</div>
          )}
        </div>
      </div>
      <div className="truncate font-mono text-[12px] text-zinc-300">{contact.phone || "—"}</div>
      <div className="truncate text-[11px] text-zinc-400">{accountLabel}</div>
      <div>
        <select
          aria-label={t("contactsTable.colStage")}
          disabled={disabled}
          value={contact.stage}
          onChange={(event) =>
            useAppStore
              .getState()
              .updateContact(contact.id, { stage: event.target.value as SalesStage })
          }
          className="ui-control h-7 w-full px-1.5 text-[11px]"
        >
          {stages.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap gap-1 overflow-hidden">
        {(contact.tags || []).slice(0, 3).map((tag) => (
          <span
            key={tag}
            className="max-w-[110px] truncate rounded bg-brand/15 px-1.5 py-0.5 text-[10px] font-medium text-brand"
          >
            {tag}
          </span>
        ))}
        {(contact.tags || []).length > 3 && (
          <span className="text-[10px] text-zinc-500">+{contact.tags.length - 3}</span>
        )}
      </div>
      <div className="min-w-0 text-[11px] text-zinc-400">
        <div className="truncate">{formatShortDate(row.lastActiveAt)}</div>
        {row.nextFollowUpAt && (
          <div className="truncate text-[10px] text-amber-400">
            {t("contactsTable.followUpPrefix")} {formatShortDate(row.nextFollowUpAt)}
          </div>
        )}
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          title={t("nav.chats")}
          aria-label={t("nav.chats")}
          onClick={() => useAppStore.getState().openContactWorkspace(contact.id)}
          className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-brand"
        >
          <MessageSquare className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
