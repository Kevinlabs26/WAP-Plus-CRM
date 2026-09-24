import { Phone, UserPlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Input } from "@/components/ui/primitives";
import { useI18n } from "@/i18n";

type Props = {
  initialName: string;
  phone: string;
  saving: boolean;
  editing?: boolean;
  hint?: string;
  onClose: () => void;
  onSave: (name: string) => void;
};

export function SaveContactDialog({ initialName, phone, saving, editing = false, hint, onClose, onSave }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState(initialName);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose, saving]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-contact-title"
      className="fixed inset-0 z-[220] flex items-center justify-center bg-black/65 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}
    >
      <form
        className="w-full max-w-sm overflow-hidden rounded-xl border border-zinc-700/90 bg-zinc-900 shadow-2xl shadow-black/50"
        onSubmit={(event) => {
          event.preventDefault();
          const value = name.trim();
          if (value && !saving) onSave(value);
        }}
      >
        <div className="flex items-start gap-3 border-b border-zinc-800 px-4 py-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-brand">
            <UserPlus className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="save-contact-title" className="text-[14px] font-semibold text-zinc-100">
              {t(editing ? "saveContact.editTitle" : "saveContact.title")}
            </h2>
            <p className="mt-0.5 text-[11px] text-zinc-500">{hint || t("saveContact.hint")}</p>
          </div>
          <button
            type="button"
            aria-label={t("common.close")}
            disabled={saving}
            onClick={onClose}
            className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-4 py-4">
          <label className="block text-[11px] text-zinc-400">
            {t("saveContact.name")}
            <Input
              autoFocus
              value={name}
              maxLength={100}
              placeholder={t("saveContact.namePlaceholder")}
              className="mt-1 h-9"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2.5">
            <Phone className="h-3.5 w-3.5 text-zinc-500" />
            <span className="font-mono text-[12px] text-zinc-300">{phone}</span>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-800 px-4 py-3">
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={!name.trim() || saving}>
            {saving ? t("common.saving") : t(editing ? "saveContact.update" : "saveContact.title")}
          </Button>
        </div>
      </form>
    </div>
  );
}
