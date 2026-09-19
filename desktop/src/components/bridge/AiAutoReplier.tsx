import { useEffect } from "react";
import { onLiveInboundMessages, autoReplyInbound } from "@/lib/aiAutoReply";
import { latestMessagesPerChat } from "@/lib/aiSafety";

/**
 * AI 全自动回复：订阅实时入站私聊消息，按设置生成并自动发送回复。
 * 判定/限流/连接检查都在 lib/aiAutoReply 里，组件只做挂载。
 */
export function AiAutoReplier() {
  useEffect(() => {
    return onLiveInboundMessages((messages) => {
      // 同批连续消息按会话合并，只回复该会话最新一条。
      for (const m of latestMessagesPerChat(messages)) {
        void autoReplyInbound(m);
      }
    });
  }, []);

  return null;
}
