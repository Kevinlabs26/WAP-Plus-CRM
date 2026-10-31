import { VoiceRecordingControls } from "@/components/chat/VoiceRecordingControls";
import { MediaSendPreview } from "@/components/chat/MediaSendPreview";
import { TranslateBar } from "@/components/chat/TranslateBar";
import { useEffect, useLayoutEffect, useRef, type ComponentProps } from "react";
import { Mic, Pencil, Reply, Send, X, Zap } from "lucide-react";
import { Textarea } from "@/components/ui/primitives";
import { toggleComposerBold } from "@/lib/composerFormatting";
import { MultiWindowAttachmentButton } from "@/features/multiWindow/components/MultiWindowAttachmentButton";
import { useI18n } from "@/i18n";
import { onQuickReplyMedia, quickReplyMediaToFile } from "@/lib/quickReplyMedia";

export function MultiWindowComposer({
  chatId,
  value,
  onChange,
  onSend,
  onEditLatest,
  onAttach,
  ariaLabel,
  disabled = false,
  compact = false,
  onOpenQuickReplies,
  context,
  voice,
  onBeginVoice,
  translation,
  media,
}: {
  chatId: string;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onEditLatest?: () => boolean;
  onAttach?: (file: File, caption?: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  compact?: boolean;
  onOpenQuickReplies?: () => void;
  voice?: ComponentProps<typeof VoiceRecordingControls>;
  onBeginVoice?: () => void;
  translation?: ComponentProps<typeof TranslateBar>;
  media?: ComponentProps<typeof MediaSendPreview> & { onSend: () => void };
  context?: {
    kind: "edit" | "reply";
    preview: string;
    onCancel: () => void;
  };
}) {
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const hasMedia = !!media?.items.length;
  const busy = disabled || (media?.sendingIndex ?? -1) >= 0;
  const submit = () => {
    if (busy || voice) return;
    if (hasMedia) media?.onSend();
    else if (value.trim()) onSend();
  };

  useEffect(() => {
    if (!onAttach) return;
    return onQuickReplyMedia((selection) => {
      if (selection.target !== "multi" || selection.chatId !== chatId || busy || voice || (media?.items.length || 0) >= 5) return;
      const file = quickReplyMediaToFile(selection);
      if (!file) return false;
      const caption = selection.caption ? value ? `${value}\n${selection.caption}` : selection.caption : value;
      onAttach(file, caption); return true;
    });
  }, [chatId, busy, onAttach, voice, value, media?.items.length]);

  useLayoutEffect(() => {
    const input = textareaRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 96)}px`;
  }, [value]);

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
        submit();
      }}
    >
      {voice ? <VoiceRecordingControls {...voice} /> : <>
      {hasMedia && media && <MediaSendPreview {...media} compact />}
      {translation && <TranslateBar {...translation} compact />}
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
            disabled={busy}
          />
        )}
        <button
          type="button"
          disabled={busy}
          title={t("multi.quickReplies")}
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
            if (event.key === "Escape" && hasMedia && !busy) {
              event.preventDefault();
              media?.onClose();
              return;
            }
            if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "t") {
              event.preventDefault();
              if (!disabled && !composingRef.current) translation?.onTranslate();
              return;
            }
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
              event.key === "ArrowUp" &&
              !event.altKey &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.shiftKey &&
              !composingRef.current &&
              !hasMedia &&
              !value.trim() &&
              onEditLatest?.()
            ) {
              event.preventDefault();
              return;
            }
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !composingRef.current &&
              !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229
            ) {
              event.preventDefault();
              submit();
            }
          }}
          rows={1}
          disabled={busy}
          placeholder={
            hasMedia ? t("mediaPreview.captionPlaceholder") : context?.kind === "edit" ? t("multi.editPlaceholder") : t("multi.messagePlaceholder")
          }
          className={`max-h-24 min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-950/70 text-[13px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-brand/60 disabled:opacity-50 ${compact ? "min-h-7 px-2 py-1" : "min-h-8 px-2.5 py-1.5"}`}
          aria-label={ariaLabel}
        />
        <button
          type={!hasMedia && !value.trim() && onBeginVoice ? "button" : "submit"}
          onClick={!hasMedia && !value.trim() ? onBeginVoice : undefined}
          title={!hasMedia && !value.trim() && onBeginVoice ? t("tooltip.startRecording") : t("multi.send")}
          disabled={busy || (!hasMedia && !value.trim() && !onBeginVoice)}
          className={`inline-flex shrink-0 items-center justify-center rounded-lg bg-brand/90 text-white transition-colors hover:bg-brand disabled:cursor-not-allowed disabled:opacity-30 ${compact ? "h-7 w-7" : "h-8 w-8"}`}
          aria-label={!hasMedia && !value.trim() && onBeginVoice ? t("tooltip.startRecording") : t("multi.send")}
        >
          {!hasMedia && !value.trim() && onBeginVoice ? <Mic className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
        </button>
      </div>
      </>}
    </form>
  );
}
