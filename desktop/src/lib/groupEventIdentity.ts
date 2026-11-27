export function groupEventJid(value: unknown): string | undefined {
  return typeof value === "string" && /^\d{1,32}(?::\d{1,8})?@(?:lid|s\.whatsapp\.net|c\.us)$/.test(value)
    ? value
    : undefined;
}

export function groupEventParticipants(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = new Set(value.slice(0, 256).map(groupEventJid).filter((jid) => jid !== undefined));
  return ids.size ? [...ids] : undefined;
}
