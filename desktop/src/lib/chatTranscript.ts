import type { Message } from "@/types/crm";
import { loadMessagesPage } from "./storage";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function messageText(message: Message): string {
  const parts = [message.body, message.mediaCaption, message.transcript].filter(
    Boolean
  );
  if (parts.length) return parts.join("\n");
  const media = message.mediaFileName || message.mediaType;
  return media ? `[${media}]` : "[空消息]";
}

export async function loadCompleteChatMessages(
  chatId: string,
  memoryMessages: Message[]
): Promise<Message[]> {
  const byId = new Map(memoryMessages.map((message) => [message.id, message]));
  let beforeSentAt: string | null = null;
  let beforeId: string | null = null;
  let loaded = 0;

  while (true) {
    const page = await loadMessagesPage({
      chatId,
      beforeSentAt,
      beforeId,
      limit: 500,
    });
    if (!page) break;
    const items = page.items as Message[];
    if (!items.length) break;
    for (const message of items) byId.set(message.id, message);
    loaded += items.length;
    if (loaded >= page.total || items.length < page.limit) break;
    const oldest = items[0];
    if (!oldest || (oldest.sentAt === beforeSentAt && oldest.id === beforeId)) {
      break;
    }
    beforeSentAt = oldest.sentAt;
    beforeId = oldest.id;
  }

  return [...byId.values()].sort(
    (a, b) => a.sentAt.localeCompare(b.sentAt) || a.id.localeCompare(b.id)
  );
}

export function buildChatTranscriptHtml(input: {
  title: string;
  accountName?: string;
  messages: Message[];
}): string {
  const exportedAt = new Date().toLocaleString("zh-CN");
  const rows = input.messages
    .map((message) => {
      const sender =
        message.direction === "out" ? "我" : message.senderName || input.title;
      const time = new Date(message.sentAt).toLocaleString("zh-CN");
      return `<article class="message ${message.direction}"><div class="meta"><strong>${escapeHtml(sender)}</strong><time>${escapeHtml(time)}</time></div><div class="body">${escapeHtml(messageText(message)).replaceAll("\n", "<br>")}</div></article>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(input.title)} - 聊天记录</title>
<style>body{margin:0;background:#f4f4f5;color:#18181b;font:14px/1.55 system-ui,sans-serif}.wrap{max-width:820px;margin:auto;padding:32px 18px}header{margin-bottom:24px}.sub{color:#71717a;font-size:12px}.message{max-width:76%;margin:10px 0;padding:10px 12px;border:1px solid #e4e4e7;border-radius:12px;background:white;break-inside:avoid}.message.out{margin-left:auto;background:#dcfce7;border-color:#bbf7d0}.meta{display:flex;gap:12px;justify-content:space-between;color:#71717a;font-size:11px}.body{margin-top:5px;white-space:normal;overflow-wrap:anywhere}@media print{body{background:white}.wrap{max-width:none;padding:0}.message{box-shadow:none}}</style></head>
<body><main class="wrap"><header><h1>${escapeHtml(input.title)}</h1><div class="sub">${input.accountName ? `账号：${escapeHtml(input.accountName)} · ` : ""}${input.messages.length} 条消息 · 导出于 ${escapeHtml(exportedAt)}</div></header>${rows || '<p class="sub">暂无消息</p>'}</main></body></html>`;
}

export function chatTranscriptFilename(title: string): string {
  const safe = title.replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 60) || "聊天记录";
  return `${safe}-聊天记录-${new Date().toISOString().slice(0, 10)}.html`;
}
