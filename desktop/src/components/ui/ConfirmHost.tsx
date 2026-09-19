import { useEffect, useRef } from "react";
import { useAppStore } from "@/store/appStore";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

/**
 * 全局确认框宿主：替代 window.confirm / alert，深色风格与应用一致。
 */
export function ConfirmHost() {
  const dialog = useAppStore((s) => s.confirmDialog);
  const resolveConfirm = useAppStore((s) => s.resolveConfirm);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    if (!dialog) return;
    const focusBtn =
      dialog.tone === "danger" ? cancelRef.current : confirmRef.current;
    focusBtn?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        resolveConfirm(false);
      } else if (e.key === "Enter" && !e.isComposing) {
        // 危险操作不响应 Enter 误触
        if (dialog.tone === "danger") return;
        e.preventDefault();
        resolveConfirm(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, resolveConfirm]);

  if (!dialog) return null;

  const danger = dialog.tone === "danger";

  return (
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) resolveConfirm(false);
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`confirm-title-${dialog.id}`}
        aria-describedby={
          dialog.description ? `confirm-desc-${dialog.id}` : undefined
        }
        className="confirm-modal-box w-full max-w-[22rem] overflow-hidden rounded-2xl border border-zinc-700/80 bg-zinc-900/95 shadow-2xl shadow-black/40 backdrop-blur-md"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-4 pt-4 pb-1">
          <h2
            id={`confirm-title-${dialog.id}`}
            className="text-[14px] font-semibold leading-snug text-zinc-100"
          >
            {dialog.title}
          </h2>
          {dialog.description ? (
            <p
              id={`confirm-desc-${dialog.id}`}
              className="mt-2 text-[12px] leading-relaxed text-zinc-400"
            >
              {dialog.description}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3">
          <button
            ref={cancelRef}
            type="button"
            className="ui-btn-secondary !min-h-8 !px-3 text-2xs"
            onClick={() => resolveConfirm(false)}
          >
            {dialog.cancelLabel || t("common.cancel")}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={cn(
              "!min-h-8 !px-3 text-2xs",
              danger
                ? "rounded-md border border-rose-500/40 bg-rose-500/15 px-3 py-1.5 font-medium text-rose-200 transition-colors hover:bg-rose-500/25"
                : "ui-btn-primary"
            )}
            onClick={() => resolveConfirm(true)}
          >
            {dialog.confirmLabel || t("common.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
