type IngestEventLike = {
  type: string;
  payload?: unknown;
};

function payloadObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function isLiveMessagesSyncPayload(payloadValue: unknown): boolean {
  const payload = payloadObject(payloadValue);
  const live = payload.live;
  const source = typeof payload.source === "string" ? payload.source : "";
  return (
    live === true ||
    (live !== false &&
      source !== "history" &&
      source !== "snapshot" &&
      source !== "sync")
  );
}

/**
 * Live message upserts already update their affected contact/chat incrementally.
 * Full-dataset repair is reserved for deletes and completed history/snapshot syncs.
 */
export function needsFullMessageReconcile(
  events: readonly IngestEventLike[]
): boolean {
  return events.some((event) => {
    if (event.type === "messages.delete" || event.type === "chats.delete") {
      return true;
    }
    if (event.type !== "messages.sync") return false;
    const payload = payloadObject(event.payload);
    return (
      payload.syncBatchFinal !== false &&
      !isLiveMessagesSyncPayload(payload)
    );
  });
}
