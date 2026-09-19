import { useState } from "react";
import type { AppState } from "@/store/appStore";
import type { ChatPreview, Contact, Message } from "@/types/crm";
import { displayContactLabel } from "@/lib/utils";
import { downloadText } from "@/lib/exportData";
import {
  buildChatTranscriptHtml,
  chatTranscriptFilename,
  loadCompleteChatMessages,
} from "@/lib/chatTranscript";
import { syncLog } from "@/lib/syncDebug";

type UseChatExportOptions = {
  activeChat: ChatPreview | undefined;
  activeContact: Contact | null | undefined;
  chatMessages: Message[];
  chatAccount?: { userName?: string; label?: string } | undefined;
  pushToast: AppState["pushToast"];
};

/**
 * 聊天记录导出（HTML 转储），从 ChatPanel 抽离。
 */
export function useChatExport(opts: UseChatExportOptions) {
  const [exportingChat, setExportingChat] = useState(false);

  const exportChat = async () => {
    if (!opts.activeChat || exportingChat) return;
    setExportingChat(true);
    try {
      const title = displayContactLabel(
        opts.activeContact?.name || opts.activeChat.contactName,
        opts.activeContact?.phone,
        opts.activeContact?.channelAddress,
        opts.activeChat.lastMessage,
        {
          isGroup: !!(opts.activeContact?.isGroup || opts.activeChat.isGroup),
        }
      );
      const messages = await loadCompleteChatMessages(
        opts.activeChat.id,
        opts.chatMessages
      );
      downloadText(
        chatTranscriptFilename(title),
        buildChatTranscriptHtml({
          title,
          accountName: opts.chatAccount?.userName || opts.chatAccount?.label,
          messages,
        }),
        "text/html;charset=utf-8"
      );
      opts.pushToast(`已导出 ${messages.length} 条聊天记录`, "success");
    } catch (error) {
      syncLog("ui.chat", "transcript export failed", {
        chatId: opts.activeChat.id,
        error: String(error),
      });
      opts.pushToast("聊天记录导出失败", "error");
    } finally {
      setExportingChat(false);
    }
  };

  return { exportingChat, exportChat };
}
