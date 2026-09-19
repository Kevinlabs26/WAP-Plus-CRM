import { useEffect, useRef } from "react";
import { baileysPresence } from "@/lib/baileys";

export type ComposerPresenceTarget = {
  phoneE164?: string;
  jid?: string;
  channelAddress?: string;
  accountId?: string | null;
};

/**
 * WhatsApp composing/paused presence 发射：rAF 合并 + 2.5s 节流，
 * 避免每个按键都 POST。卸载时清理定时器。
 */
export function useComposerPresence(opts: {
  isBaileys: boolean;
  baileysConnected: boolean;
  resolvePresenceTarget?: () => ComposerPresenceTarget | null;
}) {
  const { isBaileys, baileysConnected, resolvePresenceTarget } = opts;
  const lastComposingAt = useRef(0);
  const lastPresenceTarget = useRef<ComposerPresenceTarget | null>(null);
  const presenceTimer = useRef<number | null>(null);
  const presenceFrame = useRef<number | null>(null);

  const emitComposing = () => {
    if (!isBaileys || !baileysConnected || !resolvePresenceTarget) return;
    const now = Date.now();
    // WhatsApp composing 无需每个按键都 POST；2.5s 内只重排 paused 定时器
    if (now - lastComposingAt.current <= 2500) {
      if (presenceTimer.current) window.clearTimeout(presenceTimer.current);
      presenceTimer.current = window.setTimeout(() => {
        const t = lastPresenceTarget.current;
        if (t) void baileysPresence("paused", t).catch(() => undefined);
      }, 2500);
      return;
    }
    const target = resolvePresenceTarget();
    if (!target) return;
    lastPresenceTarget.current = target;
    lastComposingAt.current = now;
    window.setTimeout(() => {
      void baileysPresence("composing", target).catch(() => undefined);
    }, 0);
    if (presenceTimer.current) window.clearTimeout(presenceTimer.current);
    presenceTimer.current = window.setTimeout(() => {
      void baileysPresence("paused", target).catch(() => undefined);
    }, 2500);
  };

  const scheduleComposing = () => {
    if (presenceFrame.current != null) return;
    presenceFrame.current = requestAnimationFrame(() => {
      presenceFrame.current = null;
      emitComposing();
    });
  };

  useEffect(() => {
    return () => {
      if (presenceFrame.current != null) {
        cancelAnimationFrame(presenceFrame.current);
      }
      if (presenceTimer.current != null) {
        window.clearTimeout(presenceTimer.current);
      }
    };
  }, []);

  return { emitComposing, scheduleComposing };
}
