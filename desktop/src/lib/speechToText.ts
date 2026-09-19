/**
 * 语音输入（说话 → 文字）服务层。
 * 两种引擎，统一接口：
 * - browser：浏览器 Web Speech API 实时识别（在线、免费、无 Key）
 * - ai：录音后调用 transcribeVoice（Groq whisper / Gemini / 自定义），松手才出结果
 * auto 时浏览器优先，不支持再降级 ai。
 */
import { transcribeVoice } from "@/lib/transcribeVoice";
import { startVoiceRecording } from "@/lib/voiceRecord";
import type { AppSettings } from "@/store/appStore";
import { resolveVoiceInputLanguageTag } from "@/lib/voiceInputLanguage";

export type VoiceInputResult = {
  text: string;
  /** 最终结果来源引擎 */
  engine: "browser" | "ai";
  fallback?: boolean;
};

export type VoiceInputSession = {
  /** 引擎是否可用 */
  readonly engine: "browser" | "ai";
  readonly languageLabel: string;
  /** 浏览器引擎的部分结果回调（ai 引擎无中间结果） */
  onInterim?: (text: string) => void;
  stop: () => Promise<VoiceInputResult>;
  cancel: () => void;
};

type BrowserRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function browserRecognitionCtor():
  | (new () => BrowserRecognition)
  | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as {
    SpeechRecognition?: new () => BrowserRecognition;
    webkitSpeechRecognition?: new () => BrowserRecognition;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || undefined;
}

export function canUseBrowserSpeech(): boolean {
  return !!browserRecognitionCtor();
}

export function resolveVoiceInputEngine(
  settings: AppSettings
): "browser" | "ai" {
  if (settings.voiceInputEngine === "browser") return "browser";
  if (settings.voiceInputEngine === "ai") return "ai";
  // auto
  return canUseBrowserSpeech() ? "browser" : "ai";
}

function startBrowserSession(opts: {
  settings: AppSettings;
  onInterim?: (text: string) => void;
  onError?: (message: string) => void;
}): VoiceInputSession {
  const Ctor = browserRecognitionCtor();
  if (!Ctor) throw new Error("当前环境不支持浏览器语音识别");

  const recognition = new Ctor();
  recognition.lang = resolveVoiceInputLanguageTag(
    opts.settings.voiceInputLang,
    typeof navigator !== "undefined" ? navigator.language : "en-US"
  );
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  // 识别状态机：end 后需重启以支持长句；用户手动 stop 则不再重启
  let stoppedByUser = false;
  let restartTimer: number | null = null;
  let errored = false;
  let finalText = "";
  let lastShown = "";
  const scheduleRestart = () => {
    if (stoppedByUser || errored) return;
    restartTimer = window.setTimeout(() => {
      try {
        recognition.start();
      } catch {
        /* 重启失败即结束 */
      }
    }, 120);
  };

  recognition.onresult = (e: unknown) => {
    const event = e as {
      resultIndex?: number;
      results?: {
        length: number;
        [i: number]: {
          isFinal?: boolean;
          0?: { transcript?: string };
        };
      };
    };
    const results = event.results;
    if (!results) return;
    let interim = "";
    for (let i = event.resultIndex ?? 0; i < results.length; i++) {
      const item = results[i];
      if (!item) continue;
      const transcript = item[0]?.transcript || "";
      if (item.isFinal) finalText += transcript;
      else interim += transcript;
    }
    lastShown = finalText + interim;
    if (lastShown.trim()) opts.onInterim?.(lastShown);
  };
  recognition.onerror = (e: unknown) => {
    const err = (e as { error?: string }).error;
    errored = true;
    opts.onError?.(err ? `语音识别失败（${err}）` : "语音识别失败");
  };
  recognition.onend = () => scheduleRestart();

  recognition.start();

  return {
    engine: "browser",
    languageLabel: recognition.lang.split("-")[0]!.toUpperCase(),
    onInterim: opts.onInterim,
    stop: async () => {
      stoppedByUser = true;
      if (restartTimer != null) window.clearTimeout(restartTimer);
      try {
        recognition.stop();
      } catch {
        /* ignore */
      }
      // 给浏览器一点时间 flush 最后一段 interim → final
      await new Promise((r) => window.setTimeout(r, 250));
      const text = lastShown.trim();
      return { text, engine: "browser" };
    },
    cancel: () => {
      stoppedByUser = true;
      if (restartTimer != null) window.clearTimeout(restartTimer);
      try {
        recognition.abort();
      } catch {
        /* ignore */
      }
    },
  };
}

async function startAiSession(opts: {
  settings: AppSettings;
  onError?: (message: string) => void;
}): Promise<VoiceInputSession> {
  const recording = await startVoiceRecording();
  let cancelled = false;
  return {
    engine: "ai",
    languageLabel: opts.settings.voiceInputLang?.toUpperCase() || "AUTO",
    stop: async () => {
      if (cancelled) return { text: "", engine: "ai" };
      const { dataUrl, mimeType: mime } = await recording.stop();
      const res = await transcribeVoice(dataUrl, mime, opts.settings);
      if (!res.text.trim()) {
        opts.onError?.(res.error || "转写为空");
        return { text: "", engine: "ai", fallback: res.fallback };
      }
      return { text: res.text.trim(), engine: "ai", fallback: res.fallback };
    },
    cancel: () => {
      cancelled = true;
      recording.cancel();
    },
  };
}

/**
 * 开始一次语音输入会话。调用方负责 stop()/cancel() 释放资源。
 * 传入 mimeType（仅 ai 引擎用）由内部决定。
 */
export async function startVoiceInput(opts: {
  settings: AppSettings;
  onInterim?: (text: string) => void;
  onError?: (message: string) => void;
}): Promise<VoiceInputSession> {
  const engine = resolveVoiceInputEngine(opts.settings);
  if (engine === "browser") {
    try {
      return startBrowserSession(opts);
    } catch (e) {
      // 浏览器引擎不可用/启动失败：auto 降级 ai，显式 browser 则报错
      if (opts.settings.voiceInputEngine === "browser") {
        throw e instanceof Error ? e : new Error("浏览器语音识别不可用");
      }
    }
  }
  return startAiSession(opts);
}
