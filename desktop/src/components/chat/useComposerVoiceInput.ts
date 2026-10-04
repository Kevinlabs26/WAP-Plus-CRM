import { useEffect, useRef, useState } from "react";
import type { AppSettings } from "@/store/appStore";
import { startVoiceInput, type VoiceInputSession } from "@/lib/speechToText";

type UseComposerVoiceInputOptions = {
  editingId: string | null;
  pushToast: (message: string, tone?: "info" | "success" | "error") => void;
  fullSettings: () => AppSettings;
  readDraft?: () => string;
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
  const voiceRequestRef = useRef(0);
  const voiceErrorShownRef = useRef(false);
  const voiceOriginalDraftRef = useRef("");
  const voiceInterimRef = useRef<string | null>(null);
  const voiceDraftChangedRef = useRef(false);
  useEffect(() => () => {
    voiceRequestRef.current++;
    voiceInputSessionRef.current?.cancel();
    voiceInputSessionRef.current = null;
  }, []);

  const restoreInterimDraft = () => {
    if (voiceInterimRef.current !== null && opts.readDraft?.() === voiceInterimRef.current) {
      setDraftLocal(voiceOriginalDraftRef.current);
      flushDraftNow(voiceOriginalDraftRef.current);
    }
    voiceInterimRef.current = null;
  };

  const showVoiceError = (message: string) => {
    restoreInterimDraft();
    if (!voiceErrorShownRef.current) pushToast(message, "error");
    voiceErrorShownRef.current = true;
  };

  const draftIsUnchanged = () => !voiceDraftChangedRef.current &&
    (!opts.readDraft || opts.readDraft() === (voiceInterimRef.current ?? voiceOriginalDraftRef.current));

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
    const request = ++voiceRequestRef.current;
    voiceErrorShownRef.current = false;
    voiceOriginalDraftRef.current = opts.readDraft?.() || "";
    voiceInterimRef.current = null;
    voiceDraftChangedRef.current = false;
    setVoiceInputBusy(true);
    setVoiceInputOpen(true);
    try {
      const session = await startVoiceInput({
        settings: fullSettings(),
        onInterim: (text) => {
          if (request !== voiceRequestRef.current || voiceErrorShownRef.current) return;
          if (!draftIsUnchanged()) { voiceDraftChangedRef.current = true; return; }
          // 浏览器引擎：实时回填到草稿，末尾保留光标
          voiceInterimRef.current = text;
          setDraftLocal(text);
          focusTextarea();
        },
        onError: (message) => { if (request === voiceRequestRef.current) showVoiceError(message); },
      });
      if (request !== voiceRequestRef.current) { session.cancel(); return; }
      voiceInputSessionRef.current = session;
      setVoiceInputEngineLabel(
        `${session.engine === "browser" ? "浏览器实时" : "AI 转写"} · ${session.languageLabel}`
      );
      setVoiceInputBusy(false);
    } catch (e) {
      if (request !== voiceRequestRef.current) return;
      setVoiceInputBusy(false);
      setVoiceInputOpen(false);
      showVoiceError(e instanceof Error ? e.message : "语音输入失败");
    }
  };

  const handleFinishVoiceInput = async () => {
    const session = voiceInputSessionRef.current;
    if (!session) return;
    const request = voiceRequestRef.current;
    voiceInputSessionRef.current = null;
    setVoiceInputBusy(true);
    try {
      const result = await session.stop();
      if (request !== voiceRequestRef.current) return;
      if (result.fallback || result.error || !result.text.trim()) {
        showVoiceError(result.error || "识别结果为空，请重试");
      } else if (!voiceErrorShownRef.current) {
        if (draftIsUnchanged()) {
          setDraftLocal(result.text.trim());
          flushDraftNow(result.text.trim());
          focusTextarea();
        } else {
          pushToast("草稿已修改，语音结果未覆盖当前内容", "info");
        }
      }
    } catch (e) {
      if (request !== voiceRequestRef.current) return;
      showVoiceError(e instanceof Error ? e.message : "语音输入失败");
    } finally {
      if (request === voiceRequestRef.current) {
        setVoiceInputBusy(false);
        setVoiceInputOpen(false);
        setVoiceInputEngineLabel("");
      }
    }
  };

  const cancelVoiceInput = (restoreDraft: boolean) => {
    if (restoreDraft) restoreInterimDraft();
    voiceRequestRef.current++;
    voiceInputSessionRef.current?.cancel();
    voiceInputSessionRef.current = null;
    setVoiceInputBusy(false);
    setVoiceInputOpen(false);
    setVoiceInputEngineLabel("");
  };
  const handleCancelVoiceInput = () => cancelVoiceInput(true);

  /** 切换会话时重置 */
  const resetVoiceInput = () => {
    cancelVoiceInput(false);
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
