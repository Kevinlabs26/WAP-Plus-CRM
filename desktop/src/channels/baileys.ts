import { baileysSend, baileysStatus } from "@/lib/baileys";
import { resolveSendTarget } from "@/lib/utils";
import type { MessageChannel } from "./types";

function notConnectedResult(message?: string) {
  return {
    ok: false as const,
    delivered: false as const,
    channel: "baileys" as const,
    status: "queued" as const,
    message:
      message || "WhatsApp 未连接：请点顶栏「点击扫码」完成登录",
    error: "baileys_not_connected",
    retryAfterMs: 4000,
  };
}

export const baileysChannel: MessageChannel = {
  id: "baileys",
  async health() {
    try {
      const status = await baileysStatus();
      return {
        channel: "baileys",
        ok: status.connection === "connected",
        detail:
          status.connection === "connected"
            ? "WhatsApp 已连接"
            : "请扫码连接 WhatsApp",
      };
    } catch (error) {
      return { channel: "baileys", ok: false, detail: String(error) };
    }
  },
  async sendText(input) {
    // phoneE164 字段实际可能是 E.164 / jid / @lid（统一发送槽）
    const rawTo = (input.phoneE164 || "").trim();
    const target =
      resolveSendTarget({
        phone: rawTo,
        channelAddress: rawTo,
        jid: rawTo,
      }) || rawTo;
    if (!target || !input.text?.trim()) {
      return {
        ok: false,
        delivered: false,
        channel: "baileys",
        status: "failed",
        message: "号码或消息为空（需要手机号或有效 WhatsApp 地址/@lid）",
        error: "invalid_recipient",
      };
    }
    const accountId = input.accountId || undefined;
    try {
      const status = await baileysStatus(accountId);
      if (status.connection !== "connected") {
        return notConnectedResult();
      }
      const raw = await baileysSend(target, input.text, {
        quoted: input.quoted,
        accountId,
        mentionedJid: input.mentionedJid,
      });
      if (!raw?.ok) {
        return {
          ok: false,
          delivered: false,
          channel: "baileys",
          status: "failed",
          message: "发送未确认成功",
          error: "baileys_send_failed",
          raw,
        };
      }
      return {
        ok: true,
        delivered: true,
        channel: "baileys",
        status: "sent",
        message: "已通过 WhatsApp 发送",
        raw,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const lower = msg.toLowerCase();
      if (
        msg.includes("尚未连接") ||
        msg.includes("未连接") ||
        lower.includes("not connected") ||
        msg.includes("请扫码")
      ) {
        return notConnectedResult(msg);
      }
      // 启动中 / 瞬断：可重试
      if (
        lower.includes("failed to fetch") ||
        msg.includes("无法连接") ||
        lower.includes("econn") ||
        lower.includes("timeout") ||
        msg.includes("409")
      ) {
        return {
          ok: false,
          delivered: false,
          channel: "baileys",
          status: "failed",
          message: `发送结果未知，请先在 WhatsApp 核对后再手动重试（${msg}）`,
          error: "baileys_delivery_unknown",
        };
      }
      return {
        ok: false,
        delivered: false,
        channel: "baileys",
        status: "failed",
        message: msg,
        error: "baileys_send_failed",
      };
    }
  },
};
