import { Smartphone, Wifi, WifiOff } from "lucide-react";
import { useI18n } from "@/i18n";

export function MultiWindowConnectionBadge({
  channel,
  connected,
  onOpenDevices,
}: {
  channel: "baileys" | "android_bridge";
  connected: boolean;
  onOpenDevices?: () => void;
}) {
  const { t } = useI18n();
  if (channel === "android_bridge") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-500/10 px-1.5 py-0.5 text-[9px] text-sky-300" title={t("multi.phoneBridgeTitle")}>
        <Smartphone className="h-2.5 w-2.5" />
        {t("multi.phoneBridge")}
      </span>
    );
  }

  return connected ? (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] text-emerald-300" title={t("multi.connectedTitle")}>
      <Wifi className="h-2.5 w-2.5" />
      {t("multi.connected")}
    </span>
  ) : (
    <button type="button" onClick={onOpenDevices} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-rose-500/10 px-1.5 py-0.5 text-[9px] text-rose-300 transition-colors hover:bg-rose-500/20" title={t("multi.disconnectedTitle")}>
      <WifiOff className="h-2.5 w-2.5" />
      {t("multi.disconnected")}
    </button>
  );
}
