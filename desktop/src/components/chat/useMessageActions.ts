import { useCallback, useState } from "react";
import type { AppState } from "@/store/appStore";
import { useAppStore } from "@/store/appStore";
import type { Message } from "@/types/crm";
import { transcribeVoice } from "@/lib/transcribeVoice";
import { resolveMyLang, translateDraftText } from "@/lib/translateDraft";
import { translateMessage } from "./translateMessageAction";

/**
 * 单条消息操作：语音转写 + 翻译，从 ChatPanel 抽离。
 */
export function useMessageActions(opts: {
  patchMessage: AppState["patchMessage"];
  pushToast: AppState["pushToast"];
}) {
  const [transcribingId, setTranscribingId] = useState<string | null>(null);
  const [translatingId, setTranslatingId] = useState<string | null>(null);

  const transcribe = useCallback(
    async (messageId: string) => {
      const message = useAppStore
        .getState()
        .messages.find((item) => item.id === messageId);
      if (!message?.mediaUrl) {
        opts.pushToast("语音尚未加载完成", "info");
        return;
      }
      setTranscribingId(messageId);
      try {
        const result = await transcribeVoice(
          message.mediaUrl,
          message.mediaMime || "audio/webm",
          useAppStore.getState().settings
        );
        const patch: Partial<Message> = { transcript: result.text };
        if (!result.fallback && result.text.trim()) {
          const settings = useAppStore.getState().settings;
          const myLang = resolveMyLang(settings);
          const translated = await translateDraftText(
            result.text,
            myLang,
            settings
          );
          if (!translated.fallback && translated.text.trim()) {
            patch.translation = translated.text;
            patch.translationLang = translated.targetLang;
          }
        }
        opts.patchMessage(messageId, patch);
        opts.pushToast(
          result.fallback
            ? result.error
              ? `语音转写失败：${result.error}`
              : "已生成转写演示结果"
            : patch.translation
              ? "语音已转写并翻译"
              : "语音已转成文字",
          result.fallback ? "info" : "success"
        );
      } finally {
        setTranscribingId(null);
      }
    },
    [opts.patchMessage, opts.pushToast]
  );

  const translate = useCallback(
    async (messageId: string) => {
      const message = useAppStore
        .getState()
        .messages.find((item) => item.id === messageId);
      if (!message) return;
      const settings = useAppStore.getState().settings;
      const myLang = resolveMyLang(settings);
      return translateMessage({
        message,
        targetLang: myLang,
        settings,
        patchMessage: opts.patchMessage,
        setTranslatingId,
        pushToast: opts.pushToast,
      });
    },
    [opts.patchMessage, opts.pushToast]
  );

  return { transcribingId, translatingId, transcribe, translate };
}
