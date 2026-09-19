import type { ChatPreview } from "@/types/crm";
import type { FolderWindow } from "@/features/multiWindow/types";

export function collectUnreadChatIdsForWindows(
  windowIds: string[],
  windowsByChatId: Map<string, FolderWindow>,
  chatsById: Map<string, ChatPreview>
) {
  const memberIds = new Set<string>();
  for (const windowId of windowIds) {
    const window = windowsByChatId.get(windowId);
    for (const memberId of window?.memberChatIds || [windowId]) {
      memberIds.add(memberId);
    }
  }
  return [...memberIds].filter((chatId) => (chatsById.get(chatId)?.unread || 0) > 0);
}
