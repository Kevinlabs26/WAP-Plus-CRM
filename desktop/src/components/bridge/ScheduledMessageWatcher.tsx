import { useEffect, useRef } from "react";
import { useAppStore } from "@/store/appStore";
import type { Message } from "@/types/crm";

const POLL_MS = 2_000;

function isDelivered(message: Message) {
  return ["local", "sent", "server", "delivered", "read", "played"].includes(
    message.deliveryStatus || "sent"
  );
}

/** 到点后把定时任务交给现有出站队列，避免重复实现连接/限速/重试。 */
export function ScheduledMessageWatcher() {
  const running = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const tick = () => {
      if (cancelled || running.current) return;
      running.current = true;
      try {
        const state = useAppStore.getState();
        const tasks = state.settings.scheduledMessages || [];

        for (const task of tasks) {
          if (task.status !== "queued" || !task.messageId) continue;
          const message = state.messages.find((item) => item.id === task.messageId);
          if (!message) {
            state.updateScheduledMessage(task.id, {
              status: "failed",
              error: "定时消息对应的出站记录不存在",
            });
            continue;
          }
          if (isDelivered(message)) {
            state.updateScheduledMessage(task.id, {
              status: "sent",
              error: undefined,
            });
          } else if (message.deliveryStatus === "failed" && !message.nextAttemptAt) {
            state.updateScheduledMessage(task.id, {
              status: "failed",
              error: message.lastError || "发送失败",
            });
          }
        }

        const now = Date.now();
        for (const task of useAppStore.getState().settings.scheduledMessages || []) {
          if (task.status !== "pending" || Date.parse(task.dueAt) > now) continue;
          const latest = useAppStore.getState();
          const chat = latest.chats.find((item) => item.id === task.chatId);
          const contact = latest.contacts.find((item) => item.id === task.contactId);
          if (!chat || !contact) {
            latest.updateScheduledMessage(task.id, {
              status: "failed",
              error: "联系人或会话已不存在",
            });
            continue;
          }
          const accountId = task.accountId;
          if (task.channelId === "baileys" &&
              (!accountId || !latest.settings.waAccounts.some((account) => account.id === accountId))) {
            latest.updateScheduledMessage(task.id, {
              status: "failed",
              error: "原发送账号不存在，请重新创建定时消息",
            });
            continue;
          }
          const messageId = latest.enqueueOutgoingMessage({
            chatId: task.chatId,
            contactId: task.contactId,
            body: task.text,
            phoneE164: task.recipient,
            channelId: task.channelId,
            deviceId: task.deviceId,
            accountId: accountId || undefined,
            deliveryStatus: "queued",
            nextAttemptAt: new Date().toISOString(),
          });
          if (!messageId) {
            latest.updateScheduledMessage(task.id, {
              status: "failed",
              error: "无法创建出站消息",
            });
            continue;
          }
          latest.updateScheduledMessage(task.id, {
            status: "queued",
            messageId,
            error: undefined,
          });
          latest.pushToast(`定时消息已到点，正在发送给 ${task.contactName}`, "info");
        }
      } finally {
        running.current = false;
      }
    };

    tick();
    const timer = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
