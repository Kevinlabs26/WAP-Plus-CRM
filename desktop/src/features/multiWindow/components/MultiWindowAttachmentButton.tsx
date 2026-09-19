import { useRef } from "react";
import { Paperclip } from "lucide-react";
import { useI18n } from "@/i18n";

export function MultiWindowAttachmentButton({
  onSelect,
  disabled = false,
}: {
  onSelect: (file: File) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) onSelect(file);
        }}
        aria-hidden="true"
        tabIndex={-1}
      />
      <button
        type="button"
        disabled={disabled}
        aria-label={t("multi.addAttachment")}
        title={t("multi.addAttachment")}
        onClick={() => inputRef.current?.click()}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-800 text-zinc-500 transition-colors hover:border-brand/40 hover:text-brand disabled:cursor-not-allowed disabled:opacity-30"
      >
        <Paperclip className="h-3.5 w-3.5" />
      </button>
    </>
  );
}
