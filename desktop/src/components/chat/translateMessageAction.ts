import { translateDraftText } from "@/lib/translateDraft";
import type { AppSettings } from "@/store/appStore";
import type { Message } from "@/types/crm";

type TranslateMessageDeps = {
  message: Message;
  targetLang: string;
  settings: AppSettings;
  patchMessage: (id: string, patch: Partial<Message>) => boolean;
  setTranslatingId: (id: string | null) => void;
  pushToast: (message: string, kind?: "success" | "error" | "info") => void;
};

export async function translateMessage({
  message,
  targetLang,
  settings,
  patchMessage,
  setTranslatingId,
  pushToast,
}: TranslateMessageDeps) {
  const text = (message.body || "").trim();
  if (!text) {
    pushToast("没有可翻译的文字内容", "info");
    return;
  }
  setTranslatingId(message.id);
  try {
    const res = await translateDraftText(text, targetLang, settings);
    if (res.error && res.fallback) {
      pushToast(res.error, "info");
    }
    if (!res.fallback && res.text) {
      patchMessage(message.id, {
        translation: res.text,
        translationLang: res.targetLang,
      });
    }
  } catch (error) {
    pushToast(error instanceof Error ? error.message : "翻译失败", "error");
  } finally {
    setTranslatingId(null);
  }
}
