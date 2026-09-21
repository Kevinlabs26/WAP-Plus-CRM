/**
 * 媒体/直发统一发送门闸。
 *
 * 文本走 dispatchSendText（内部 assertSendGate），但图片/贴纸/GIF/语音/
 * 文件/商品等媒体路径此前直接调用 baileysSend*，完全绕过门闸——账号在
 * 「监测」中暂停后仍可发媒体、不限速、也不计入 outbound 统计（反向稀释
 * 文本路径的过热门闸）。本包装让所有 Baileys 媒体发送与文本路径共用同一套
 * 暂停/过热/限速/warmup 配置（实时取自 store settings）。
 */
import { useAppStore } from "@/store/appStore";
import { sendRuntimeFromSettings } from "./index";
import { withSendGate } from "./sendGate";

const MAX_AUTO_RETRY_WAIT_MS = 15_000;
const MAX_AUTO_RETRIES = 3;

export class MediaGateBlockedError extends Error {
  readonly gateError: "send_paused" | "overheated" | "rate_limited";
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    gateError: MediaGateBlockedError["gateError"],
    retryAfterMs?: number
  ) {
    super(message);
    this.name = "MediaGateBlockedError";
    this.gateError = gateError;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * 门闸通过 → 执行 sendFn，成功后记账（与文本路径同一套 outbound 统计）；
 * 被拦截 → 抛 MediaGateBlockedError。调用方 catch 里按普通发送失败处理即可，
 * error.message 已是面向用户的中文原因。
 */
export async function gatedMediaSend<T>(
  input: { phoneE164: string; accountId?: string | null },
  sendFn: () => Promise<T>
): Promise<T> {
  const state = useAppStore.getState();
  const runtime = sendRuntimeFromSettings(state.settings, state.messages);
  const accountId =
    input.accountId ||
    state.settings.liveBaileysAccountId ||
    state.settings.activeAccountId ||
    "wa-default";
  let out = await withSendGate(
    { phoneE164: input.phoneE164, accountId },
    runtime,
    sendFn
  );
  for (let attempt = 0; !out.ok && attempt < MAX_AUTO_RETRIES; attempt++) {
    const waitMs = out.gate.retryAfterMs;
    if (
      out.gate.error !== "rate_limited" ||
      !waitMs ||
      waitMs > MAX_AUTO_RETRY_WAIT_MS
    ) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, waitMs + 100));
    out = await withSendGate(
      { phoneE164: input.phoneE164, accountId },
      runtime,
      sendFn
    );
  }
  if (!out.ok) {
    throw new MediaGateBlockedError(
      out.gate.reason,
      out.gate.error,
      out.gate.retryAfterMs
    );
  }
  return out.result;
}
