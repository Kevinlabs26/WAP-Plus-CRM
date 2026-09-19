/**
 * 历史同步阶段状态 → 桌面端可展示进度。
 */

/**
 * @param {any} sock
 * @param {{ push: (type: string, payload: object) => void }} deps
 */
export function attachHistoryStatusEvents(sock, deps) {
  if (!sock?.ev?.on) return () => {};

  const onStatus = (payload) => {
    try {
      if (!payload) return;
      deps.push("history.sync_status", {
        syncType: payload.syncType ?? null,
        status: payload.status || "",
        explicit: Boolean(payload.explicit),
        at: Date.now(),
        source: "messaging-history.status",
      });
    } catch {
      /* ignore */
    }
  };

  sock.ev.on("messaging-history.status", onStatus);
  return () => {
    try {
      sock.ev.off("messaging-history.status", onStatus);
    } catch {
      /* ignore */
    }
  };
}
