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
  if (connected) return null;
  const label = t(channel === "android_bridge" ? "multi.bridgeOffline" : "multi.accountOffline");
  const dot = <span aria-hidden="true" className="block h-1.5 w-1.5 rounded-full bg-rose-500" />;
  const actionLabel = `${label} · ${t("multi.connectionDetails")}`;
  return onOpenDevices ? <button type="button" onClick={onOpenDevices} title={actionLabel} aria-label={actionLabel} className="shrink-0 rounded p-1.5 hover:bg-rose-500/10">{dot}</button>
    : <span role="img" title={label} aria-label={label} className="shrink-0 p-1.5">{dot}</span>;
}
