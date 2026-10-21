import { loadMessagesPage } from "@/lib/storage";
import type { Message } from "@/types/crm";

export type HistoryCursor = { beforeSentAt: string; beforeId: string };
export type HistoryPage = { cursor: HistoryCursor | null; hasMore: boolean; added: number };

/** 游标以磁盘原始页为准，重复消息不能阻止继续读取更早的历史。 */
export async function loadChatHistoryPage(
  chatId: string,
  cursor: HistoryCursor | null,
  mergePage: (items: Message[]) => number,
  limit = 80
): Promise<HistoryPage> {
  while (true) {
    const page = await loadMessagesPage({ chatId, ...cursor, limit });
    const items = (page?.items || []) as Message[];
    if (!items.length) return { cursor, hasMore: false, added: 0 };
    const oldest = items[0];
    const next = { beforeSentAt: oldest.sentAt, beforeId: oldest.id };
    if (cursor && cursor.beforeSentAt === next.beforeSentAt && cursor.beforeId === next.beforeId) {
      throw new Error("聊天历史分页游标未前进，请重试");
    }
    cursor = next;
    const added = mergePage(items);
    const hasMore = items.length >= (page?.limit || limit);
    if (added > 0 || !hasMore) return { cursor, hasMore, added };
  }
}
