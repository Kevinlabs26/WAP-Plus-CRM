import { useEffect } from "react";
import { useAppStore } from "@/store/appStore";
import { notifyDueFollowUps } from "@/lib/followUpDueNotify";
import type { FollowUp } from "@/types/crm";

const POLL_MS = 60_000;

function openFollowUp(f: FollowUp) {
  const st = useAppStore.getState();
  const latest = st.messages
    .filter((m) => m.contactId === f.contactId)
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0];
  st.openContactWorkspace(f.contactId, {
    focusMessageId: latest?.id,
    prefillDraft: f.note ? `【跟进】${f.note}` : undefined,
  });
}

/**
 * 后台扫描逾期待跟进 / 今日已到点跟进，弹系统通知。
 */
export function FollowUpDueWatcher() {
  useEffect(() => {
    let cancelled = false;
    let resumeTimer: number | null = null;

    const tick = () => {
      if (cancelled) return;
      const s = useAppStore.getState();
      if (s.settings.desktopNotifyEnabled === false) return;
      if (s.settings.notifyFollowUpEnabled === false) return;
      notifyDueFollowUps(s.followUps, {
        enabled: true,
        suppressWhenFocusedToday: true,
        activeNav: s.activeNav,
        openFollowUp,
      });
    };

    // 进主界面后稍晚第一扫，避免与 hydrate/通知权限抢节奏
    const first = window.setTimeout(tick, 8_000);
    const iv = window.setInterval(tick, POLL_MS);
    const onVis = () => {
      if (resumeTimer != null) window.clearTimeout(resumeTimer);
      resumeTimer = null;
      if (document.visibilityState === "visible") {
        resumeTimer = window.setTimeout(() => {
          resumeTimer = null;
          tick();
        }, 1_500);
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      window.clearTimeout(first);
      window.clearInterval(iv);
      if (resumeTimer != null) window.clearTimeout(resumeTimer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return null;
}
