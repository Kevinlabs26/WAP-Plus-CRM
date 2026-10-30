import { create } from "zustand";

export type AutoReplyPhase = "waiting" | "transcribing" | "generating" | "retry" | "human";
export interface AutoReplyRuntime {
  phase: AutoReplyPhase;
  inboundId: string;
  accountId?: string;
  reason?: string;
  retryAt?: number;
}
// Runtime only: status must never restart automation or enter backups.
export const useAutoReplyRuntime = create<{ byChat: Record<string, AutoReplyRuntime> }>(() => ({ byChat: {} }));
export function setAutoReplyRuntime(chatId: string, value: AutoReplyRuntime | null, expectedInboundId?: string) {
  useAutoReplyRuntime.setState(state => {
    if (expectedInboundId && state.byChat[chatId]?.inboundId !== expectedInboundId) return state;
    const byChat = { ...state.byChat };
    if (value) byChat[chatId] = value;
    else delete byChat[chatId];
    return { byChat };
  });
}
