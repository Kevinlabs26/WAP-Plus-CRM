import { Download, Plug, Unplug } from "lucide-react";
import { Button, Input } from "@/components/ui/primitives";
import { useI18n } from "@/i18n";
import { isTauri, type AdbDevice } from "@/lib/bridge";
import { isMac, isWindows } from "@/lib/desktopPlatform";

type Props = {
  host: string;
  port: number;
  lastError?: string | null;
  busy: boolean;
  installing: boolean;
  connected: boolean;
  log: string;
  adb: string;
  adbDevices: AdbDevice[];
  adbSerial: string;
  onAdbDeviceChange: (serial: string) => void;
  onHostChange: (value: string) => void;
  onPortChange: (value: number) => void;
  onConnect: () => void;
  onInstall: () => void;
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
  installing,
  connected,
  log,
  adb,
  adbDevices,
  adbSerial,
  onAdbDeviceChange,
  onHostChange,
  onPortChange,
  onConnect,
  onInstall,
  onDisconnect,
  onScanAdb,
  onForward,
}: Props) {
  const { t } = useI18n();
  return (
    <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-3.5">
      <div className="text-[12px] font-medium text-zinc-300">{t("androidBridge.connectTitle")}</div>
      <p className="mt-0.5 text-[11px] text-zinc-600">
        {t("androidBridge.description")}
        {lastError ? ` · ${lastError}` : ""}
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        {isTauri() && (isWindows || isMac) && (
          <Button
            variant="secondary"
            className="!min-h-8 gap-1 !px-3 text-2xs"
            disabled={busy || installing}
            onClick={onInstall}
          >
            <Download className="h-3.5 w-3.5" />
            {t(installing ? "androidBridge.installing" : "androidBridge.install")}
          </Button>
        )}
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
          disabled={busy || installing || connected}
          onClick={onConnect}
        >
          <Plug className="h-3.5 w-3.5" />
          {busy && !connected ? t("androidBridge.connecting") : t("androidBridge.connect")}
        </Button>
        <Button
          variant="secondary"
          className="!min-h-8 gap-1 !px-3 text-2xs"
          disabled={busy || installing || !connected}
          onClick={onDisconnect}
        >
          <Unplug className="h-3.5 w-3.5" />
          {busy && connected ? t("androidBridge.disconnecting") : t("common.disconnect")}
        </Button>
      </div>

      <details className="mt-3 border-t border-zinc-800/70 pt-3">
        <summary className="cursor-pointer select-none text-2xs text-zinc-500 hover:text-zinc-300">
          {t("androidBridge.advanced")}
        </summary>
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            <Button
              variant="secondary"
              className="!min-h-8 !px-2.5 text-2xs"
              onClick={onScanAdb}
            >
              {t("androidBridge.scanAdb")}
            </Button>
            {adbDevices.length > 0 && (
              <label className="flex items-center gap-1.5 text-2xs text-zinc-400">
                ADB
                <select className="rounded border border-zinc-700 bg-zinc-900 p-1.5" value={adbSerial}
                  onChange={(event) => onAdbDeviceChange(event.target.value)}>
                  <option value="">—</option>
                  {adbDevices.map((device) => (
                    <option key={device.serial} value={device.serial} disabled={device.state !== "device"}>
                      {device.serial} · {device.state}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Button
              variant="secondary"
              className="!min-h-8 !px-2.5 text-2xs"
              disabled={busy || installing}
              onClick={onForward}
            >
              Forward :{port}
            </Button>
          </div>
          <ol className="list-decimal space-y-0.5 pl-4 text-[11px] leading-relaxed text-zinc-500">
            <li>{t("androidBridge.step1")}</li>
            <li>
              <code className="text-zinc-400">
                adb {adbSerial ? `-s ${adbSerial} ` : ""}forward tcp:{port} tcp:17890
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
