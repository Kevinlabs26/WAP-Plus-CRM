import { useAppStore } from "@/store/appStore";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import bridgeCrmIcon from "@/assets/wap-plus-crm-trimmed.svg";
import { useI18n } from "@/i18n";

export function ToastHost() {
  const { t: translate } = useI18n();
  const toasts = useAppStore((s) => s.toasts);
  const dismissToast = useAppStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[200] flex w-[min(22rem,calc(100vw-2.5rem))] flex-col items-end gap-2">
      {toasts.map((t) => t.title ? (
        <div
          key={t.id}
          role={t.onClick ? "button" : "status"}
          tabIndex={t.onClick ? 0 : undefined}
          className="pointer-events-auto flex w-full cursor-pointer items-start gap-3 rounded-xl border border-zinc-700/80 bg-zinc-900/95 p-3.5 text-left shadow-2xl shadow-black/40 backdrop-blur-xl transition hover:border-brand/40 hover:bg-zinc-900"
          onClick={t.onClick}
          onKeyDown={(event) => {
            if (t.onClick && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault();
              t.onClick();
            }
          }}
        >
          <img
            src={bridgeCrmIcon}
            alt=""
            className="h-9 w-9 shrink-0 rounded-lg"
          />
          <div className="min-w-0 flex-1">
            <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-brand">
              WAP Plus CRM · {translate("toast.newMessage")}
            </p>
            <p className="truncate text-[13px] font-semibold text-zinc-100">
              {t.title}
            </p>
            <p className="mt-1 line-clamp-2 break-words text-xs leading-5 text-zinc-400">
              {t.message}
            </p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            onClick={(event) => {
              event.stopPropagation();
              dismissToast(t.id);
            }}
            aria-label={translate("common.close")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto inline-flex max-w-full items-center gap-2 rounded-lg border px-3 py-2 text-[13px] shadow-lg backdrop-blur",
            t.tone === "success" &&
              "border-brand/30 bg-zinc-900/95 text-zinc-100",
            t.tone === "error" &&
              "border-red-500/40 bg-zinc-900/95 text-red-100",
            t.tone === "info" &&
              "border-zinc-700 bg-zinc-900/95 text-zinc-200"
          )}
        >
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              t.tone === "success" && "bg-brand",
              t.tone === "error" && "bg-red-400",
              t.tone === "info" && "bg-zinc-400"
            )}
          />
          <p className="max-w-[16rem] leading-snug break-words">{t.message}</p>
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            onClick={() => dismissToast(t.id)}
            aria-label={translate("common.close")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
