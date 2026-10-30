import { useEffect, useState } from "react";
import { Input } from "@/components/ui/primitives";
import { useI18n } from "@/i18n";

export function SettingsNumberInput({ value, min, max, integer = false, disabled, className, onCommit }: {
  value: number; min: number; max?: number; integer?: boolean; disabled?: boolean; className?: string; onCommit: (value: number) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setDraft(String(value)); setInvalid(false); }, [value]);
  function commit() {
    const number = Number(draft);
    if (!draft.trim() || !Number.isFinite(number) || number < min || (max !== undefined && number > max) || (integer && !Number.isInteger(number))) {
      setDraft(String(value)); setInvalid(true); return;
    }
    setInvalid(false); setDraft(String(number));
    if (number !== value) onCommit(number);
  }
  return <>
    <Input type="number" min={min} max={max} step={integer ? 1 : "any"} value={draft} disabled={disabled} className={className} aria-invalid={invalid || undefined}
      onChange={event => { setDraft(event.target.value); setInvalid(false); }} onBlur={commit}
      onKeyDown={event => {
        if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
        if (event.key === "Escape" && draft !== String(value)) { event.preventDefault(); event.stopPropagation(); setDraft(String(value)); setInvalid(false); }
      }} />
    {invalid && <span role="alert" className="mt-1 block text-2xs text-amber-500">{t(integer ? "settings.numberInvalidInteger" : "settings.numberInvalid", { min, max: max ?? "∞" })}</span>}
  </>;
}
