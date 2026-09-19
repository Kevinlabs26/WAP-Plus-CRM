import { Plug, Unplug } from "lucide-react";
import { Button, Input } from "@/components/ui/primitives";
import { useI18n } from "@/i18n";

type Props = {
  host: string;
  port: number;
  lastError?: string | null;
  busy: boolean;
  connected: boolean;
  log: string;
  adb: string;
  onHostChange: (value: string) => void;
  onPortChange: (value: number) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onScanAdb: () => void;
  onForward: () => void;
};

/**
 * 真机 Bridge 连接面板：Host/Port 编辑、连接/断开、ADB 排障与端口转发。
 */
export function AndroidBridgePanel({
  host,
  port,
  lastError,
  busy,
  connected,
  log,
  adb,
  onHostChange,
  onPortChange,
  onConnect,
  onDisconnect,
  onScanAdb,
  onForward,
}: Props) {
  const { t } = useI18n();
  return (
    <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-3.5">
      <div className="text-[12px] font-medium text-zinc-300">{t("androidBridge.connectTitle")}</div>
      <p className="mt-0.5 text-[11px] text-zinc-600">
        {t("androidBridge.description")}
        {lastError ? ` · ${lastError}` : ""}
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-2xs text-zinc-500">
          Host
          <Input
            value={host}
            onChange={(e) => onHostChange(e.target.value)}
            className="mt-1 w-36"
          />
        </label>
        <label className="text-2xs text-zinc-500">
          Port
          <Input
            type="number"
            value={port}
            onChange={(e) => onPortChange(Number(e.target.value) || 17890)}
            className="mt-1 w-24"
          />
        </label>
        <Button
          variant="primary"
          className="!min-h-8 gap-1 !px-3 text-2xs"
          disabled={busy || connected}
          onClick={onConnect}
        >
          <Plug className="h-3.5 w-3.5" />
          {busy && !connected ? t("androidBridge.connecting") : t("androidBridge.connect")}
        </Button>
        <Button
          variant="secondary"
          className="!min-h-8 gap-1 !px-3 text-2xs"
          disabled={busy || !connected}
          onClick={onDisconnect}
        >
          <Unplug className="h-3.5 w-3.5" />
          {busy && connected ? t("androidBridge.disconnecting") : t("common.disconnect")}
        </Button>
      </div>

      <details className="mt-3 rounded-lg border border-zinc-800/70">
        <summary className="cursor-pointer select-none px-2.5 py-1.5 text-2xs text-zinc-500 hover:text-zinc-300">
          {t("androidBridge.advanced")}
        </summary>
        <div className="space-y-2 border-t border-zinc-800/70 p-2.5">
          <div className="flex flex-wrap gap-1.5">
            <Button
              variant="secondary"
              className="!min-h-8 !px-2.5 text-2xs"
              onClick={onScanAdb}
            >
              {t("androidBridge.scanAdb")}
            </Button>
            <Button
              variant="secondary"
              className="!min-h-8 !px-2.5 text-2xs"
              disabled={busy}
              onClick={onForward}
            >
              Forward :{port}
            </Button>
          </div>
          <ol className="list-decimal space-y-0.5 pl-4 text-[11px] leading-relaxed text-zinc-500">
            <li>{t("androidBridge.step1")}</li>
            <li>
              <code className="text-zinc-400">
                adb forward tcp:{port} tcp:{port}
              </code>
            </li>
            <li>{t("androidBridge.step3")}</li>
          </ol>
          {log && (
            <pre className="max-h-20 overflow-auto rounded-md bg-zinc-950 p-2 text-2xs text-zinc-500">
              {log}
            </pre>
          )}
          <pre className="max-h-28 overflow-auto rounded-md border border-zinc-800/80 bg-zinc-950 p-2 text-2xs text-zinc-500">
            {adb}
          </pre>
        </div>
      </details>
    </div>
  );
}
