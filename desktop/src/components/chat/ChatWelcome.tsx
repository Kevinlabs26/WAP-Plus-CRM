import type { ReactNode } from "react";
import {
  Search,
  Users,
  Sparkles,
  Smartphone,
} from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { isWaAccountConnected } from "@/lib/accountConnection";
import { cn } from "@/lib/utils";
import { WapPlusMark } from "@/components/brand/WapPlusMark";
import { useI18n } from "@/i18n";

type Action = {
  id: string;
  label: string;
  hint: string;
  icon: ReactNode;
  onClick: () => void;
};

/**
 * 未选会话时的中间欢迎页（对齐官方 WA 空白主区，带 CRM 快捷入口）。
 */
export function ChatWelcome() {
  const { t } = useI18n();
  const setCommandOpen = useAppStore((s) => s.setCommandOpen);
  const setActiveNav = useAppStore((s) => s.setActiveNav);
  const setBaileysLoginOpen = useAppStore((s) => s.setBaileysLoginOpen);
  const baileysUi = useAppStore((s) => s.baileysUi);
  const bridgeConnected = useAppStore((s) => s.bridge.connected);
  const sendChannel = useAppStore((s) => s.settings.sendChannel);
  const waAccounts = useAppStore((s) => s.settings.waAccounts);
  const liveAccountId = useAppStore(
    (s) => s.settings.liveBaileysAccountId || s.settings.activeAccountId
  );
  const chatsCount = useAppStore((s) => s.chats.length);
  const isBaileys = sendChannel !== "android_bridge";
  const connected = isBaileys
    ? waAccounts.length > 0
      ? waAccounts.some((account) =>
          isWaAccountConnected(
            waAccounts,
            account.id,
            liveAccountId,
            baileysUi.connection
          )
        )
      : baileysUi.connection === "connected"
    : bridgeConnected;

  const actions: Action[] = [
    {
      id: "search",
      label: t("welcome.search"),
      hint: t("welcome.searchHint"),
      icon: <Search className="h-5 w-5" />,
      onClick: () => setCommandOpen(true),
    },
    {
      id: "crm",
      label: t("welcome.crm"),
      hint: t("welcome.crmHint"),
      icon: <Users className="h-5 w-5" />,
      onClick: () => setActiveNav("crm"),
    },
    {
      id: "ai",
      label: t("welcome.ai"),
      hint: t("welcome.aiHint"),
      icon: <Sparkles className="h-5 w-5" />,
      onClick: () => setActiveNav("chats"),
    },
  ];

  return (
    <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden bg-zinc-950 px-6">
      {/* 极淡网格，避免纯黑死板 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 50% 42%, rgba(37,211,102,0.07), transparent 42%)",
        }}
      />

      <div className="relative z-[1] flex w-full max-w-lg flex-col items-center text-center">
        <WapPlusMark
          sizeClassName="mb-5 h-16 w-16 rounded-2xl shadow-lg shadow-black/40"
        />

        <h2 className="text-[18px] font-semibold tracking-tight text-zinc-100">
          WAP Plus CRM
        </h2>
        <p className="mt-2 max-w-sm break-words text-[13px] leading-relaxed text-zinc-500">{t("welcome.description")}</p>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-[11px] text-zinc-600">
          <span className="inline-flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900/60 px-2.5 py-1">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                connected ? "bg-brand" : "bg-zinc-600"
              )}
            />
            {connected ? t("welcome.connected") : t("welcome.disconnected")}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900/60 px-2.5 py-1">
            {t("welcome.chatCount", { count: chatsCount })}
          </span>
        </div>

        <div className="mt-8 grid w-full grid-cols-1 gap-2.5 sm:grid-cols-3">
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={a.onClick}
              className={cn(
                "group flex flex-col items-center gap-2 rounded-2xl border border-zinc-800/90",
                "bg-zinc-900/50 px-3 py-4 text-center transition-colors",
                "hover:border-zinc-700 hover:bg-zinc-900"
              )}
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950 text-zinc-400 group-hover:border-brand/30 group-hover:text-brand">
                {a.icon}
              </span>
              <span className="text-[12px] font-medium text-zinc-200">
                {a.label}
              </span>
              <span className="text-2xs text-zinc-600">{a.hint}</span>
            </button>
          ))}
        </div>

        {!connected && isBaileys && (
          <button
            type="button"
            onClick={() => setBaileysLoginOpen(true)}
            className="mt-6 inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-4 py-2 text-[12px] font-medium text-brand hover:bg-brand/15"
          >
            <Smartphone className="h-3.5 w-3.5" />
            {t("welcome.connectWhatsApp")}
          </button>
        )}

        <p className="mt-8 text-[11px] text-zinc-600">
          {t("welcome.tip")}
        </p>
      </div>
    </div>
  );
}
