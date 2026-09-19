import { Loader2, Plus, Tag } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { WhatsAppLabel } from "@/types/crm";
import { useI18n } from "@/i18n";

const COLORS = [
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
];

type Props = {
  labels: WhatsAppLabel[];
  activeNames: string[];
  disabled?: boolean;
  onToggle: (label: WhatsAppLabel, enabled: boolean) => Promise<void>;
  onCreate: (name: string, color: number) => Promise<void>;
};

export function WhatsAppLabelMenu({
  labels,
  activeNames,
  disabled,
  onToggle,
  onCreate,
}: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const create = () => {
    const value = name.trim();
    if (!value || busy) return;
    setBusy("new");
    void onCreate(value, color)
      .then(() => setName(""))
      .finally(() => setBusy(null));
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-6 items-center gap-1 rounded-md border border-zinc-800 px-2 text-2xs text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 disabled:opacity-40"
        title={t("tooltip.whatsappLabels")}
      >
        <Tag className="h-3 w-3" />
        {t("tags.title")}
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-50 w-64 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-xl shadow-black/50">
          <div className="border-b border-zinc-800 px-3 py-2 text-[11px] font-medium text-zinc-200">
            {t("tags.whatsappBusiness")}
          </div>
          <div className="max-h-52 overflow-y-auto p-1.5">
            {labels.map((label) => {
              const checked = activeNames.includes(label.name);
              return (
                <label
                  key={label.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 hover:bg-zinc-800"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={busy !== null}
                    onChange={() => {
                      setBusy(label.id);
                      void onToggle(label, !checked).finally(() => setBusy(null));
                    }}
                    className="accent-emerald-500"
                  />
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: COLORS[label.color % COLORS.length] }}
                  />
                  <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-200">
                    {label.name}
                  </span>
                  {busy === label.id && (
                    <Loader2 className="h-3 w-3 animate-spin text-zinc-500" />
                  )}
                </label>
              );
            })}
            {!labels.length && (
              <div className="py-5 text-center text-2xs text-zinc-600">
                {t("tags.emptyCreate")}
              </div>
            )}
          </div>
          <div className="border-t border-zinc-800 p-2">
            <div className="mb-2 flex gap-1">
              {COLORS.map((value, index) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setColor(index)}
                  className="flex h-5 w-5 items-center justify-center rounded"
                  aria-label={t("tooltip.colorOption", { count: index + 1 })}
                >
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      color === index ? "ring-2 ring-white/70" : ""
                    }`}
                    style={{ backgroundColor: value }}
                  />
                </button>
              ))}
            </div>
            <div className="flex gap-1.5">
              <input
                value={name}
                maxLength={100}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    create();
                  }
                }}
                placeholder={t("tags.newNamePlaceholder")}
                className="h-8 min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-2 text-[11px] outline-none focus:border-brand"
              />
              <button
                type="button"
                disabled={!name.trim() || busy !== null}
                onClick={create}
                className="flex h-8 w-8 items-center justify-center rounded-md bg-brand text-white disabled:opacity-40"
                aria-label={t("tooltip.createLabel")}
              >
                {busy === "new" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
