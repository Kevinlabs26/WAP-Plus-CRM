import { useRef, useState } from "react";
import type { AppSettings } from "@/store/appStore";
import { startVoiceInput, type VoiceInputSession } from "@/lib/speechToText";

type UseComposerVoiceInputOptions = {
  editingId: string | null;
  pushToast: (message: string, tone?: "info" | "success" | "error") => void;
  fullSettings: () => AppSettings;
  setDraftLocal: (text: string) => void;
  flushDraftNow: (text: string) => void;
  focusTextarea: () => void;
};

/**
 * 语音转文字（麦克风按钮）状态机：开/关/取消 + 实时回填草稿，
 * 从 Composer 抽离以缩小组件体积。
 */
export function useComposerVoiceInput(opts: UseComposerVoiceInputOptions) {
  const {
    editingId,
    pushToast,
    fullSettings,
    setDraftLocal,
    flushDraftNow,
    focusTextarea,
  } = opts;
  const [voiceInputOpen, setVoiceInputOpen] = useState(false);
  const [voiceInputBusy, setVoiceInputBusy] = useState(false);
  const [voiceInputEngineLabel, setVoiceInputEngineLabel] = useState("");
  const [voiceLanguageOpen, setVoiceLanguageOpen] = useState(false);
  const voiceInputSessionRef = useRef<VoiceInputSession | null>(null);

  /** 语音输入：第一次点击开始听，第二次点击结束出文字 */
  const handleToggleVoiceInput = async () => {
    if (editingId) {
      pushToast("编辑模式下暂不支持语音输入", "info");
      return;
    }
    if (voiceInputSessionRef.current) {
      await handleFinishVoiceInput();
      return;
    }
    if (voiceInputBusy) return;
    setVoiceInputBusy(true);
    setVoiceInputOpen(true);
    try {
      const session = await startVoiceInput({
        settings: fullSettings(),
        onInterim: (text) => {
          // 浏览器引擎：实时回填到草稿，末尾保留光标
          setDraftLocal(text);
          focusTextarea();
        },
        onError: (message) => pushToast(message, "info"),
      });
      voiceInputSessionRef.current = session;
      setVoiceInputEngineLabel(
        `${session.engine === "browser" ? "浏览器实时" : "AI 转写"} · ${session.languageLabel}`
      );
      setVoiceInputBusy(false);
    } catch (e) {
      setVoiceInputBusy(false);
      setVoiceInputOpen(false);
      pushToast(
        e instanceof Error ? e.message : "语音输入失败",
        "error"
      );
    }
  };

  const handleFinishVoiceInput = async () => {
    const session = voiceInputSessionRef.current;
    if (!session) return;
    voiceInputSessionRef.current = null;
    setVoiceInputBusy(true);
    try {
      const result = await session.stop();
      if (result.text) {
        flushDraftNow(result.text);
        focusTextarea();
      } else if (result.fallback) {
        pushToast("识别结果为空，请重试", "info");
      }
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "语音输入失败", "error");
    } finally {
      setVoiceInputBusy(false);
      setVoiceInputOpen(false);
      setVoiceInputEngineLabel("");
    }
  };

  const handleCancelVoiceInput = () => {
    voiceInputSessionRef.current?.cancel();
    voiceInputSessionRef.current = null;
    setVoiceInputBusy(false);
    setVoiceInputOpen(false);
    setVoiceInputEngineLabel("");
  };

  /** 切换会话时重置 */
  const resetVoiceInput = () => {
    voiceInputSessionRef.current?.cancel();
    voiceInputSessionRef.current = null;
    setVoiceInputBusy(false);
    setVoiceInputOpen(false);
    setVoiceInputEngineLabel("");
    setVoiceLanguageOpen(false);
  };

  return {
    voiceInputOpen,
    voiceInputBusy,
    voiceInputEngineLabel,
    voiceLanguageOpen,
    setVoiceLanguageOpen,
    handleToggleVoiceInput,
    handleFinishVoiceInput,
    handleCancelVoiceInput,
    resetVoiceInput,
  };
}
