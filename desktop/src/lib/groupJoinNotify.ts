/**
 * 入群申请事件 → Toast + 桌面通知。
 */
import { showDesktopNotify } from "@/lib/desktopNotify";

export type JoinRequestNotifyEvent = {
  type?: string;
  payload?: {
    groupJid?: string;
    groupName?: string;
    participant?: string;
    action?: string;
    title?: string;
    body?: string;
    at?: number;
  };
  deviceId?: string;
};

type Handlers = {
  pushToast: (message: string, tone?: "info" | "success" | "error") => void;
  /** 点击通知时打开对应群会话 */
  openGroup?: (groupJid: string, accountId?: string) => void;
};

const recent = new Map<string, number>();

function dedupeKey(ev: JoinRequestNotifyEvent) {
  const p = ev.payload || {};
  return [
    ev.deviceId || "",
    p.groupJid || "",
    p.participant || "",
    p.action || "",
    p.at || "",
  ].join("|");
}

export function notifyGroupJoinRequests(
  events: JoinRequestNotifyEvent[],
  handlers: Handlers
) {
  const now = Date.now();
  for (const [k, t] of recent) {
    if (now - t > 120_000) recent.delete(k);
  }

  for (const ev of events) {
    if (ev.type !== "group.join_request") continue;
    const p = ev.payload || {};
    if (String(p.action || "created") !== "created") continue;
    const key = dedupeKey(ev);
    if (recent.has(key)) continue;
    recent.set(key, now);

    const title = p.title || `${p.groupName || "群组"} · 入群申请`;
    const body = p.body || "有人申请加入群组";
    handlers.pushToast(`${title}：${body}`, "info");

    void showDesktopNotify({
      title,
      body,
      tag: `gjoin-${p.groupJid || ""}-${p.participant || ""}`,
      onClick: () => {
        if (p.groupJid) handlers.openGroup?.(p.groupJid, ev.deviceId);
      },
    });
  }
}
