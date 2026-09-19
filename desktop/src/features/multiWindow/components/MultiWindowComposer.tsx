import { useRef } from "react";
import { Pencil, Reply, Send, X, Zap } from "lucide-react";
import { Textarea } from "@/components/ui/primitives";
import { toggleComposerBold } from "@/lib/composerFormatting";
import { MultiWindowAttachmentButton } from "@/features/multiWindow/components/MultiWindowAttachmentButton";
import { useI18n } from "@/i18n";

export function MultiWindowComposer({
  value,
  onChange,
  onSend,
  onAttach,
  ariaLabel,
  disabled = false,
  compact = false,
  onOpenQuickReplies,
  context,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onAttach?: (file: File) => void;
  ariaLabel: string;
  disabled?: boolean;
  compact?: boolean;
  onOpenQuickReplies?: () => void;
  context?: {
    kind: "edit" | "reply";
    preview: string;
    onCancel: () => void;
  };
}) {
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);

  const applyBold = () => {
    const textarea = textareaRef.current;
    if (!textarea || disabled) return;
    const result = toggleComposerBold(
      value,
      textarea.selectionStart ?? value.length,
      textarea.selectionEnd ?? value.length
    );
    onChange(result.value);
    requestAnimationFrame(() => {
      const current = textareaRef.current;
      if (!current) return;
      current.focus();
      current.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  };

  return (
    <form
      className={`relative flex shrink-0 flex-col border-t border-zinc-800/80 bg-zinc-900/70 ${compact ? "gap-1 p-1.5" : "gap-1.5 p-2"}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && value.trim()) onSend();
      }}
    >
      {context && (
        <div
          className={`flex w-full items-center gap-2 rounded-md border px-2 py-1 text-[10px] ${context.kind === "edit" ? "border-amber-500/25 bg-amber-500/10 text-amber-100" : "border-brand/25 bg-brand/5 text-zinc-300"}`}
        >
          {context.kind === "edit" ? (
            <Pencil className="h-3 w-3 shrink-0 text-amber-300" />
          ) : (
            <Reply className="h-3 w-3 shrink-0 text-brand" />
          )}
          <span className="shrink-0 font-medium">
            {context.kind === "edit" ? t("multi.editMessage") : t("multi.replyQuote")}
          </span>
          <span className="min-w-0 flex-1 truncate text-zinc-500">
            {context.preview}
          </span>
          <button
            type="button"
            onClick={context.onCancel}
            className="shrink-0 rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label={context.kind === "edit" ? t("multi.cancelEdit") : t("multi.cancelQuote")}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
      <div
        className={`flex w-full items-end ${compact ? "gap-1" : "gap-1.5"}`}
      >
        {onAttach && (
          <MultiWindowAttachmentButton
            onSelect={onAttach}
            disabled={disabled}
          />
        )}
        <button
          type="button"
          disabled={disabled}
          aria-label={t("multi.quickReplies")}
          onClick={onOpenQuickReplies}
          className={`inline-flex shrink-0 items-center justify-center rounded-lg border border-zinc-800 text-zinc-500 transition-colors hover:border-brand/40 hover:text-brand disabled:cursor-not-allowed disabled:opacity-30 ${compact ? "h-7 w-7" : "h-8 w-8"}`}
        >
          <Zap className="h-3.5 w-3.5" />
        </button>
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          onKeyDown={(event) => {
            if (
              (event.ctrlKey || event.metaKey) &&
              !event.altKey &&
              event.key.toLowerCase() === "b"
            ) {
              event.preventDefault();
              applyBold();
              return;
            }
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !composingRef.current
            ) {
              event.preventDefault();
              if (!disabled && value.trim()) onSend();
            }
          }}
          rows={1}
          disabled={disabled}
          placeholder={
            context?.kind === "edit" ? t("multi.editPlaceholder") : t("multi.messagePlaceholder")
          }
          className={`max-h-16 flex-1 rounded-lg border border-zinc-800 bg-zinc-950/70 text-[11px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-brand/60 disabled:opacity-50 ${compact ? "min-h-7 px-2 py-1" : "min-h-8 px-2.5 py-1.5"}`}
          aria-label={ariaLabel}
        />
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          className={`inline-flex shrink-0 items-center justify-center rounded-lg bg-brand/90 text-white transition-colors hover:bg-brand disabled:cursor-not-allowed disabled:opacity-30 ${compact ? "h-7 w-7" : "h-8 w-8"}`}
          aria-label={t("multi.send")}
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </form>
  );
}
