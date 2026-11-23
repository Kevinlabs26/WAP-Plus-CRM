import { bridgeInvoke, getBridgeStatus, isTauri } from "@/lib/bridge";
import type {
  ChannelHealth,
  MessageChannel,
  SendTextInput,
  SendTextResult,
} from "./types";

/**
 * 主通道：真实 Android 手机 WhatsApp Business。
 */
export const androidBridgeChannel: MessageChannel = {
  id: "android_bridge",

  async health(): Promise<ChannelHealth> {
    if (!isTauri()) {
      return {
        channel: "android_bridge",
        ok: false,
        detail: "浏览器预览无法连真机，请使用 npm run tauri dev",
      };
    }
    try {
      const s = await getBridgeStatus();
      if (s && "mock" in s && s.mock) {
        return {
          channel: "android_bridge",
          ok: false,
          detail: "未处于 Tauri 环境",
        };
      }
      if (s.connected) {
        const name = s.devices?.[0]?.name;
        return {
          channel: "android_bridge",
          ok: true,
          detail: name
            ? `已连接 · ${name}`
            : `已连接 ${s.host}:${s.port}`,
        };
      }
      return {
        channel: "android_bridge",
        ok: false,
        detail: `未连接 Bridge（${s.host || "127.0.0.1"}:${s.port || 17890}）`,
      };
    } catch (e) {
      return {
        channel: "android_bridge",
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      };
    }
  },

  async sendText(input: SendTextInput): Promise<SendTextResult> {
    if (!input.phoneE164?.trim()) {
      return {
        ok: false,
        delivered: false,
        channel: "android_bridge",
        status: "failed",
        message: "缺少客户电话",
        error: "phoneE164 required",
      };
    }
    if (!input.text?.trim()) {
      return {
        ok: false,
        delivered: false,
        channel: "android_bridge",
        status: "failed",
        message: "消息为空",
      };
    }

    try {
      const res = await bridgeInvoke<{
        mock?: boolean;
        delivered?: boolean;
        status?: "failed" | "unknown" | "clicked" | "phone_sent" | "delivered";
        deviceId?: string;
        note?: string;
      }>("type_and_send", {
        deviceId: input.deviceId ?? null,
        text: input.text,
        phoneE164: input.phoneE164,
        confirmSent: input.confirmPhoneSend === true,
      });

      if (res?.mock) {
        return {
          ok: true,
          delivered: false,
          channel: "android_bridge",
          status: "local",
          message: "已写入本地（预览模式，未到手机）",
          raw: res,
        };
      }
      if (res?.status === "phone_sent" || (res?.status === "delivered" && res.delivered)) {
        return {
          ok: true,
          delivered: res.status === "delivered",
          channel: "android_bridge",
          status: "sent",
          message: res.note || "已提交至手机 WhatsApp Business",
          deviceId: res.deviceId,
          raw: res,
        };
      }
      return {
        ok: false,
        delivered: false,
        channel: "android_bridge",
        status: "failed",
        message: res?.note || "未收到手机发送结果，请在 WhatsApp 核对",
        deliveryUncertain: res?.status !== "failed",
        deviceId: res?.deviceId,
        raw: res,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        delivered: false,
        channel: "android_bridge",
        status: "failed",
        message: msg,
        deliveryUncertain: true,
      };
    }
  },
};
