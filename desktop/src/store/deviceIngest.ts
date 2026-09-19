import type { PhoneDevice } from "@/types/crm";
import { ingestString } from "./bridgeIngestHelpers.ts";

/** 虚拟 Baileys 通道（不是真机）；多账号事件 deviceId 会是 wa-* / baileys */
export function isBaileysPhone(
  p: Pick<PhoneDevice, "id" | "model" | "remark">
): boolean {
  const id = (p.id || "").toLowerCase();
  const model = (p.model || "").toLowerCase();
  const remark = (p.remark || "").toLowerCase();
  if (remark === "baileys") return true;
  if (model.includes("baileys")) return true;
  if (id === "baileys" || id.startsWith("baileys:")) return true;
  // 桌面账号槽 id（wa-default / wa-xxxx）被误写成 phones 行
  if (id === "wa-default" || id.startsWith("wa-")) return true;
  return false;
}

export function isAndroidBridgePhone(
  p: Pick<PhoneDevice, "id" | "model" | "remark">
): boolean {
  return !isBaileysPhone(p);
}

/** 把历史上堆出来的多张 Baileys 卡合并成一张 */
export function dedupePhones(phones: PhoneDevice[]): PhoneDevice[] {
  const android: PhoneDevice[] = [];
  const baileysList: PhoneDevice[] = [];
  for (const p of phones) {
    if (isBaileysPhone(p)) {
      baileysList.push(p);
      continue;
    }
    const idx = android.findIndex((x) => x.id === p.id);
    if (idx >= 0) {
      android[idx] = { ...android[idx]!, ...p };
    } else {
      android.push(p);
    }
  }
  if (!baileysList.length) return android;
  const first = baileysList[0]!;
  const merged: PhoneDevice = {
    ...first,
    id: "baileys",
    remark: "Baileys",
    model: first.model?.toLowerCase().includes("baileys")
      ? first.model
      : "Baileys",
    online: baileysList.some((x) => x.online),
    battery: Math.max(...baileysList.map((x) => x.battery || 0), 0),
    name:
      baileysList.find((x) => x.name && x.name !== "E")?.name ||
      first.name ||
      "WhatsApp（扫码）",
  };
  return [merged, ...android];
}

/** device.hello → 注册/更新 Bridge 设备行 */
export function applyDeviceHello(
  phones: PhoneDevice[],
  deviceId: string,
  payload: Record<string, unknown>
): PhoneDevice[] {
  const model = ingestString(payload.model, 200) || "Android";
  const isBaileys =
    deviceId === "baileys" ||
    deviceId.startsWith("baileys") ||
    deviceId === "wa-default" ||
    deviceId.startsWith("wa-") ||
    model.toLowerCase().includes("baileys");

  // Baileys 多账号只保留一张虚拟通道卡，真机才按 deviceId 分行
  const id = isBaileys ? "baileys" : deviceId;
  const phone: PhoneDevice = {
    id,
    name: isBaileys
      ? ingestString(payload.name, 200) || "WhatsApp（扫码）"
      : ingestString(payload.name, 200) || model,
    model: isBaileys ? "Baileys" : model,
    remark: isBaileys ? "Baileys" : "Android Bridge",
    online: true,
    battery: typeof payload.battery === "number" ? payload.battery : isBaileys ? 100 : 0,
  };
  const base = dedupePhones(phones);
  const index = base.findIndex((item) => item.id === id);
  if (index >= 0) {
    const next = [...base];
    next[index] = { ...next[index], ...phone };
    return next;
  }
  return [...base, phone];
}

/** device.status / device.battery */
export function applyDeviceStatus(
  phones: PhoneDevice[],
  deviceId: string,
  payload: Record<string, unknown>
): PhoneDevice[] {
  const normalized =
    deviceId === "baileys" ||
    deviceId.startsWith("baileys") ||
    deviceId === "wa-default" ||
    deviceId.startsWith("wa-")
      ? "baileys"
      : deviceId;
  const base = dedupePhones(phones);
  const index = base.findIndex((item) => item.id === normalized);
  if (index < 0) return base;
  const next = [...base];
  next[index] = {
    ...next[index],
    online:
      typeof payload.online === "boolean"
        ? payload.online
        : next[index].online,
    battery:
      typeof payload.level === "number" ? payload.level : next[index].battery,
    charging:
      typeof payload.charging === "boolean"
        ? payload.charging
        : next[index].charging,
    whatsappInstalled:
      typeof payload.whatsappInstalled === "boolean"
        ? payload.whatsappInstalled
        : next[index].whatsappInstalled,
    accessibilityEnabled:
      typeof payload.accessibilityEnabled === "boolean"
        ? payload.accessibilityEnabled
        : next[index].accessibilityEnabled,
    overlayEnabled:
      typeof payload.overlayEnabled === "boolean"
        ? payload.overlayEnabled
        : next[index].overlayEnabled,
  };
  return next;
}
