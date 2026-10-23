/**
 * 语音转文字：使用独立语音服务；旧配置只在迁移时读取文字服务设置。
 * 无 Key / 失败时返回空正文与错误；错误说明不得进入转写或消息草稿。
 */
import type { AppSettings } from "@/store/appStore";
import { normalizeVoiceInputLanguage } from "@/lib/voiceInputLanguage";
import { mediaUrlToBlob } from "@/lib/mediaBlob";
import { geminiTranscribeAudio } from "./gemini.ts";
import { resolveTranscriptionConfig } from "./transcriptionConfig";

export interface TranscriptResult {
  text: string;
  source: "mock" | "local" | "openai" | "groq" | "gemini" | "custom";
  fallback: boolean;
  error?: string;
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
  config: ReturnType<typeof resolveTranscriptionConfig>;
  settings: AppSettings;
  audioBlob: Blob;
  mimeType: string;
}): Promise<string> {
  const { baseUrl, apiKey, model, provider } = opts.config;
  const url = new URL(baseUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("语音服务 Base URL 必须使用 HTTP 或 HTTPS，且不能包含账号密码");
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
    throw new Error(`${provider} ${res.status}: ${detail}`);
  }
  const data = (await res.json()) as { text?: string };
  const text = (data.text || "").trim();
  if (!text) throw new Error(`${provider} 空转写`);
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
  const config = resolveTranscriptionConfig(settings);
  const provider = config.provider;
  if (provider === "none") return failedTranscript("请在 AI 设置中单独配置语音转写服务，或安装本地语音模型");
  if (!config.apiKey || !config.model || (provider !== "gemini" && !config.baseUrl))
    return failedTranscript("语音转写服务缺少 API Key、模型名或 Base URL，请检查独立的语音设置");
  try {
    const blob = await mediaUrlToBlob(dataUrl, mimeType || "audio/webm");
    const mime = mimeType || blob.type || "audio/webm";
    if (provider === "gemini") {
      const base64 = await blobToBase64(blob);
      const text = await geminiTranscribeAudio({
        apiKey: config.apiKey,
        model: config.model,
        mimeType: mime,
        base64,
      });
      if (!text.trim()) throw new Error("gemini 空转写");
      return { text: text.trim(), source: "gemini", fallback: false };
    }
    const text = await postTranscription({
      config,
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
