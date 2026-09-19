/**
 * 安全调用 Tauri 命令：浏览器纯前端预览时不会崩。
 */

import type {
  DeviceId,
  MessageType,
  OverlayCard,
  ProtocolPayload,
} from "@shared/protocol";

export type BridgeStatus = {
  host: string;
  port: number;
  connected: boolean;
  last_error?: string | null;
  last_hello?: unknown;
  devices: Array<{
    id: string;
    name: string;
    online: boolean;
    battery: number;
    transport: string;
  }>;
  mock?: boolean;
};

/** Android 使用 id，Baileys 事件流使用 seq；消息名与 payload 共用协议类型。 */
export type BridgeEvent = {
  id?: string;
  seq?: number;
  protocolVersion?: number;
  type: MessageType;
  ts?: number;
  deviceId?: DeviceId;
  payload?: ProtocolPayload;
};

export async function bridgeInvoke<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T> {
  if (!isTauri()) {
    return {
      mock: true,
      cmd,
      args,
      ok: true,
      delivered: false,
      note: "浏览器预览模式：未连接 Tauri/Android Bridge",
      connected: false,
      host: "127.0.0.1",
      port: 17890,
      devices: [],
    } as T;
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export type AppInfo = {
  name: string;
  version: string;
  mvp: boolean;
};

export async function getAppInfo(): Promise<AppInfo> {
  return bridgeInvoke<AppInfo>("get_app_info");
}

export async function connectBridge(
  host: string,
  port: number,
  token: string
): Promise<BridgeStatus> {
  return bridgeInvoke<BridgeStatus>("bridge_connect", { host, port, token });
}

export async function disconnectBridge(): Promise<void> {
  await bridgeInvoke("bridge_disconnect");
}

export async function getBridgeStatus(): Promise<BridgeStatus> {
  return bridgeInvoke<BridgeStatus>("bridge_status");
}

export async function drainBridgeEvents(): Promise<BridgeEvent[]> {
  const result = await bridgeInvoke<BridgeEvent[]>("bridge_drain_events");
  return Array.isArray(result) ? result : [];
}

export async function adbForward(port: number): Promise<string> {
  return bridgeInvoke<string>("adb_forward", { port });
}

export async function showOverlayCard(
  deviceId: string | undefined,
  card: OverlayCard
): Promise<void> {
  await bridgeInvoke("show_overlay_card", { deviceId, ...card });
}

export async function hideOverlay(deviceId?: string): Promise<void> {
  await bridgeInvoke("hide_overlay", { deviceId });
}

export async function savePhoneContact(
  deviceId: string | undefined,
  name: string,
  phoneE164: string
): Promise<{ payload?: { status?: "saved" | "exists" } }> {
  return bridgeInvoke("save_phone_contact", { deviceId, name, phoneE164 });
}

export type PhoneContactSaveResult = {
  saved: number;
  exists: number;
  failed: number;
};

export function summarizePhoneContactSaveStatuses(
  items: Array<{ status?: "saved" | "exists" | "failed" }>,
  expected: number
): PhoneContactSaveResult {
  const result: PhoneContactSaveResult = { saved: 0, exists: 0, failed: 0 };
  for (const item of items) {
    if (item.status === "saved") result.saved += 1;
    else if (item.status === "exists") result.exists += 1;
    else result.failed += 1;
  }
  result.failed += Math.max(0, expected - items.length);
  return result;
}

export async function savePhoneContacts(
  deviceId: string,
  contacts: Array<{ name: string; phoneE164: string }>
): Promise<PhoneContactSaveResult> {
  const totals: PhoneContactSaveResult = { saved: 0, exists: 0, failed: 0 };
  for (let start = 0; start < contacts.length; start += 300) {
    const batch = contacts.slice(start, start + 300);
    const ack = await bridgeInvoke<{
      payload?: { items?: Array<{ status?: "saved" | "exists" | "failed" }> };
    }>("save_phone_contacts", { deviceId, contacts: batch });
    const items = ack.payload?.items || [];
    const result = summarizePhoneContactSaveStatuses(items, batch.length);
    totals.saved += result.saved;
    totals.exists += result.exists;
    totals.failed += result.failed;
  }
  return totals;
}
