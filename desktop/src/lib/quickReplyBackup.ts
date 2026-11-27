import { normalizeLoadedSettings, type SettingsShape, type SettingsQuickReply } from "../store/settingsDefaults";
import { MAX_QUICK_REPLY_MEDIA_TOTAL_BYTES, QUICK_REPLY_CATEGORIES } from "./quickReplies";

export function buildQuickReplyBackup(settings: SettingsShape) {
  return {
    app: "WAP Plus CRM Quick Replies", version: 1,
    quickReplies: settings.quickReplies.map(({ sheetLink: _link, ...reply }) => reply),
    quickReplyCustomCategories: settings.quickReplyCustomCategories || [],
    quickReplyCategoryLabels: settings.quickReplyCategoryLabels || {},
    quickReplyCategoryOrder: settings.quickReplyCategoryOrder || [],
    quickReplyPinnedIds: settings.quickReplyPinnedIds || [],
  };
}

export function mergeQuickReplyBackup(settings: SettingsShape, input: unknown) {
  const backup = input as ReturnType<typeof buildQuickReplyBackup>;
  if (backup?.app !== "WAP Plus CRM Quick Replies" || backup.version !== 1 ||
      !Array.isArray(backup.quickReplies) || !Array.isArray(backup.quickReplyCustomCategories)) throw Error("quickLibrary.importError");
  const replies = backup.quickReplies;
  if (replies.some(reply => !reply || typeof reply.id !== "string" || !reply.id ||
      typeof reply.title !== "string" || typeof reply.body !== "string" || typeof reply.category !== "string" ||
      (reply.translation !== undefined && typeof reply.translation !== "string"))) throw Error("quickLibrary.importError");
  const incoming = normalizeLoadedSettings(backup);
  if (incoming.quickReplies.length !== replies.length || incoming.quickReplyCustomCategories.length !== backup.quickReplyCustomCategories.length ||
      replies.some((reply, i) => reply.media && (!incoming.quickReplies[i]?.media ||
        !/^data:[^;,]+;base64,[\w+/]+={0,2}$/.test(reply.media.dataUrl)))) throw Error("quickLibrary.importError");
  const categories = [...settings.quickReplyCustomCategories];
  const categoryIds = new Map<string, string>();
  const pending = [...incoming.quickReplyCustomCategories];
  while (pending.length) {
    const index = pending.findIndex(category => !category.parentId || categoryIds.has(category.parentId));
    if (index < 0) throw Error("quickLibrary.importError");
    const [category] = pending.splice(index, 1);
    const parentId = category.parentId ? categoryIds.get(category.parentId) : undefined;
    let target = categories.find(item => item.label === category.label && item.parentId === parentId);
    if (!target) {
      target = { ...category, id: categories.some(item => item.id === category.id) ? crypto.randomUUID() : category.id, parentId };
      categories.push(target);
    }
    categoryIds.set(category.id, target.id);
  }
  const signature = (reply: SettingsQuickReply) => JSON.stringify([reply.category, reply.title, reply.body,
    reply.translation || "", reply.media?.dataUrl, reply.media?.fileName, reply.media?.kind, reply.media?.mimeType]);
  const next = [...settings.quickReplies];
  const bySignature = new Map(next.map(reply => [signature(reply), reply.id]));
  const used = new Set(next.map(reply => reply.id));
  const pinned = new Set(settings.quickReplyPinnedIds);
  const incomingPins = new Set(incoming.quickReplyPinnedIds);
  for (const original of incoming.quickReplies) {
    const { sheetLink: _link, ...reply } = original;
    reply.category = categoryIds.get(reply.category) || reply.category;
    if (reply.media) {
      const payload = reply.media.dataUrl.split(",")[1];
      reply.media = { ...reply.media, size: Math.floor(payload.length * 3 / 4) - (payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0) };
    }
    const key = signature(reply);
    let id = bySignature.get(key);
    if (!id) {
      id = used.has(reply.id) ? crypto.randomUUID() : reply.id;
      used.add(id);
      bySignature.set(key, id);
      next.push({ ...reply, id });
    }
    if (incomingPins.has(original.id)) pinned.add(id);
  }
  if (next.reduce((sum, reply) => sum + (reply.media?.size || 0), 0) > MAX_QUICK_REPLY_MEDIA_TOTAL_BYTES) throw Error("quickLibrary.mediaCapacity");
  const builtinUsed = new Set(incoming.quickReplies.map(reply => reply.category));
  const removed = settings.quickReplyRemovedCategories.filter(id => !builtinUsed.has(id));
  const builtins = new Set<string>(QUICK_REPLY_CATEGORIES.map(category => category.id));
  return {
    added: next.length - settings.quickReplies.length,
    patch: {
      quickReplies: next, quickReplyCustomCategories: categories, quickReplyPinnedIds: [...pinned], quickReplyRemovedCategories: removed,
      quickReplyCategoryLabels: { ...incoming.quickReplyCategoryLabels, ...settings.quickReplyCategoryLabels },
      quickReplyCategoryOrder: [...new Set([...settings.quickReplyCategoryOrder,
        ...incoming.quickReplyCategoryOrder.flatMap(id => categoryIds.get(id) || (builtins.has(id) ? id : []))])],
    },
  };
}
