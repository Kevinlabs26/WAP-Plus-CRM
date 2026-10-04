/**
 * 语音转文字：复用现有 AI provider（OpenAI / Groq / Gemini / 自定义 OpenAI 兼容的 whisper 转写接口）。
 * 无 Key / 失败时返回空正文与错误；错误说明不得进入转写或消息草稿。
 */
import type { AppSettings } from "@/store/appStore";
import { normalizeVoiceInputLanguage } from "@/lib/voiceInputLanguage";
import { mediaUrlToBlob } from "@/lib/mediaBlob";
import { geminiTranscribeAudio } from "./gemini.ts";

export interface TranscriptResult {
  text: string;
  source: "mock" | "local" | "openai" | "groq" | "gemini" | "custom";
  fallback: boolean;
  error?: string;
}

function hasKey(s: AppSettings): boolean {
  if (s.aiProvider === "openai") return !!s.openaiKey.trim();
  if (s.aiProvider === "groq") return !!s.groqKey.trim();
  if (s.aiProvider === "gemini") return !!s.geminiKey.trim();
  // 自定义：Base URL + Key + 转写模型名齐备才可用
  if (s.aiProvider === "custom") {
    return !!(
      s.customAiBaseUrl.trim() &&
      s.customAiKey.trim() &&
      s.customWhisperModel.trim()
    );
  }
  // ollama 无内置转写
  return false;
}

function failedTranscript(error: string): TranscriptResult {
  const detail = error.trim().slice(0, 240) || "语音转写失败";
  return {
    text: "",
    source: "mock",
    fallback: true,
    error: detail,
  };
}

async function postTranscription(opts: {
  provider: "openai" | "groq" | "custom";
  settings: AppSettings;
  audioBlob: Blob;
  mimeType: string;
}): Promise<string> {
  const isCustom = opts.provider === "custom";
  const baseUrl = isCustom
    ? (opts.settings.customAiBaseUrl || "").replace(/\/$/, "")
    : opts.provider === "openai"
      ? "https://api.openai.com/v1"
      : "https://api.groq.com/openai/v1";
  const apiKey = isCustom
    ? opts.settings.customAiKey
    : opts.provider === "openai"
      ? opts.settings.openaiKey
      : opts.settings.groqKey;
  const model = isCustom
    ? opts.settings.customWhisperModel.trim()
    : opts.provider === "groq"
      ? "whisper-large-v3-turbo"
      : "whisper-1";
  if (!baseUrl || !model) throw new Error("自定义提供商缺少 Base URL 或转写模型名");
  const ext = opts.mimeType.includes("ogg")
    ? "ogg"
    : opts.mimeType.includes("mp4")
      ? "m4a"
      : "webm";
  const form = new FormData();
  form.append(
    "file",
    new File([opts.audioBlob], `voice.${ext}`, { type: opts.mimeType })
  );
  form.append("model", model);
  form.append("response_format", "json");
  const language = normalizeVoiceInputLanguage(opts.settings.voiceInputLang);
  if (language) form.append("language", language);

  const res = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const errBody = (await res.json()) as { error?: { message?: string } };
      detail = errBody.error?.message || detail;
    } catch {
      /* ignore */
    }
    throw new Error(`${opts.provider} ${res.status}: ${detail}`);
  }
  const data = (await res.json()) as { text?: string };
  const text = (data.text || "").trim();
  if (!text) throw new Error(`${opts.provider} 空转写`);
  return text;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error("读取音频失败"));
    reader.readAsDataURL(blob);
  });
}

/**
 * 把语音 dataURL 转成文字。无 Key 或失败时返回空 text 与 error。
 */
let transcriptionInFlight = false;

export async function transcribeVoice(
  dataUrl: string,
  mimeType: string,
  settings: AppSettings
): Promise<TranscriptResult> {
  if (transcriptionInFlight) return failedTranscript("正在转写另一条语音，请完成后重试");
  transcriptionInFlight = true;
  try {
    return await transcribeVoiceImpl(dataUrl, mimeType, settings);
  } finally {
    transcriptionInFlight = false;
  }
}

async function transcribeVoiceImpl(
  dataUrl: string,
  mimeType: string,
  settings: AppSettings
): Promise<TranscriptResult> {
  // ① 本地引擎优先：装了模型就离线转写，零 Key 零配额；失败静默回落云端
  try {
    const { findReadyLocalModel, localTranscribe } = await import("./localSpeech");
    const ready = await findReadyLocalModel();
    if (ready) {
      const text = await localTranscribe({
        mediaUrl: dataUrl,
        model: ready.name,
        language: normalizeVoiceInputLanguage(settings.voiceInputLang) || undefined,
      });
      if (text.trim()) return { text: text.trim(), source: "local", fallback: false };
    }
  } catch (e) {
    console.warn("[localSpeech] 本地转写失败，回落云端：", e);
  }
  if (!hasKey(settings)) {
    const provider = settings.aiProvider === "ollama"
      ? "当前选择的 Ollama 仅支持文字，不能进行云端语音转写"
      : `当前选择的 ${settings.aiProvider} 未配置可用的语音转写 Key`;
    return failedTranscript(provider);
  }
  try {
    const blob = await mediaUrlToBlob(dataUrl, mimeType || "audio/webm");
    const mime = mimeType || blob.type || "audio/webm";
    if (settings.aiProvider === "gemini") {
      const base64 = await blobToBase64(blob);
      const text = await geminiTranscribeAudio({
        apiKey: settings.geminiKey,
        model: settings.aiModel.trim() || undefined,
        mimeType: mime,
        base64,
      });
      if (!text.trim()) throw new Error("gemini 空转写");
      return { text: text.trim(), source: "gemini", fallback: false };
    }
    const provider =
      settings.aiProvider === "custom"
        ? ("custom" as const)
        : settings.aiProvider === "openai"
          ? ("openai" as const)
          : ("groq" as const);
    const text = await postTranscription({
      provider,
      settings,
      audioBlob: blob,
      mimeType: mime,
    });
    return { text, source: provider, fallback: false };
  } catch (e) {
    const error = e instanceof Error ? e.message : "转写失败";
    return failedTranscript(error);
  }
}
