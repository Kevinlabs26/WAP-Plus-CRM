import { useMemo, useState } from "react";
import { baileysGroupCreate } from "@/lib/baileysGroups";
import { parsePhoneEntries } from "@/lib/phoneEntries";
import { useAppStore } from "@/store/appStore";
import { useI18n } from "@/i18n";
import type { Contact, GroupDetails } from "@/types/crm";

type Props = {
  open: boolean;
  onClose: () => void;
  accountId?: string | null;
  onCreated?: (group: GroupDetails) => void;
};

export function CreateGroupModal({
  open,
  onClose,
  accountId,
  onCreated,
}: Props) {
  const contacts = useAppStore((s) => s.contacts);
  const pushToast = useAppStore((s) => s.pushToast);
  const { t } = useI18n();
  const [subject, setSubject] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [extraPhones, setExtraPhones] = useState("");
  const [busy, setBusy] = useState(false);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts
      .filter((c) => !c.isGroup && (c.phone || c.channelAddress))
      .filter((c) => {
        if (!q) return true;
        const blob = `${c.name} ${c.phone || ""} ${c.channelAddress || ""}`.toLowerCase();
        return blob.includes(q);
      })
      .filter((c) => !accountId || !c.accountId || c.accountId === accountId)
      .slice(0, 80);
  }, [contacts, query, accountId]);

  if (!open) return null;

  const toggle = (c: Contact) => {
    const key = c.channelAddress || c.phone || c.id;
    setSelected((prev) =>
      prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]
    );
  };

  const submit = async () => {
    const name = subject.trim();
    if (!name) {
      pushToast(t("groupCreate.nameRequired"), "error");
      return;
    }
    const phones = parsePhoneEntries(extraPhones);
    const participants = [...selected, ...phones];
    setBusy(true);
    try {
      const res = await baileysGroupCreate(name, participants, accountId);
      if (!res.ok || !res.group) {
        pushToast(res.error || t("groupCreate.failed"), "error");
        return;
      }
      pushToast(t("groupCreate.created", { name: res.group.subject || name }), "success");
      onCreated?.(res.group);
      setSubject("");
      setSelected([]);
      setExtraPhones("");
      onClose();
    } catch (e) {
      pushToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("tooltip.newGroupDialog")}
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-xl border border-zinc-800 bg-zinc-950 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div>
            <div className="text-[14px] font-semibold text-zinc-100">
              {t("groupCreate.title")}
            </div>
            <div className="text-[11px] text-zinc-500">
              {t("groupCreate.viaCurrent")}
            </div>
          </div>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-[12px] text-zinc-400 hover:bg-zinc-800"
            onClick={onClose}
          >
            {t("groupCreate.close")}
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto px-4 py-3">
          <label className="block">
            <span className="text-[11px] text-zinc-500">{t("groupCreate.name")}</span>
            <input
              className="ui-control mt-0.5 w-full px-2.5 py-2 text-[13px]"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={100}
              placeholder={t("groupCreate.namePlaceholder")}
              autoFocus
            />
          </label>

          <label className="block">
            <span className="text-[11px] text-zinc-500">
              {t("groupCreate.extraPhones")}
            </span>
            <input
              className="ui-control mt-0.5 w-full px-2.5 py-2 text-[12px]"
              value={extraPhones}
              onChange={(e) => setExtraPhones(e.target.value)}
              placeholder="12025550123, 12025550124"
            />
          </label>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] text-zinc-500">
                {t("groupCreate.selectContacts", { count: selected.length })}
              </span>
              <input
                className="ui-control w-40 px-2 py-1 text-[11px]"
                placeholder={t("groupCreate.search")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <ul className="max-h-52 space-y-0.5 overflow-y-auto rounded-lg border border-zinc-800 p-1">
              {candidates.map((c) => {
                const key = c.channelAddress || c.phone || c.id;
                const on = selected.includes(key);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => toggle(c)}
                      className={
                        on
                          ? "flex w-full items-center gap-2 rounded-md bg-brand/15 px-2 py-1.5 text-left text-[12px] text-brand"
                          : "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-zinc-300 hover:bg-zinc-900"
                      }
                    >
                      <span
                        className={
                          on
                            ? "flex h-4 w-4 items-center justify-center rounded border border-brand bg-brand text-2xs text-[var(--brand-foreground)]"
                            : "flex h-4 w-4 rounded border border-zinc-600"
                        }
                      >
                        {on ? "✓" : ""}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {c.name || c.phone || key}
                      </span>
                      <span className="shrink-0 font-mono text-2xs text-zinc-600">
                        {c.phone || ""}
                      </span>
                    </button>
                  </li>
                );
              })}
              {candidates.length === 0 && (
                <li className="px-2 py-6 text-center text-[11px] text-zinc-600">
                  {t("groupCreate.noMatches")}
                </li>
              )}
            </ul>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-800 px-4 py-3">
          <button
            type="button"
            className="rounded-lg px-3 py-1.5 text-[12px] text-zinc-400 hover:bg-zinc-800"
            onClick={onClose}
          >
            {t("groupCreate.cancel")}
          </button>
          <button
            type="button"
            disabled={busy || !subject.trim()}
            className="rounded-lg bg-brand px-3.5 py-1.5 text-[12px] font-medium text-[var(--brand-foreground)] hover:brightness-110 disabled:opacity-40"
            onClick={() => void submit()}
          >
            {busy ? t("groupCreate.creating") : t("groupCreate.create")}
          </button>
        </div>
      </div>
    </div>
  );
}
