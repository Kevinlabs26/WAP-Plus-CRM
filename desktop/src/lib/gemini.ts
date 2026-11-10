import { AI_OUTPUT_TRUNCATED, readAiJson } from "./aiResponse.ts";
import { trackAiRequest, type AiUsageFeature } from "./aiUsage.ts";
import { vertexAccessToken,vertexBaseUrl,type VertexAiConfig } from "./vertexAi.ts";
/**
 * Gemini API 调用（Google 官方 generateContent 接口，非 OpenAI 兼容）。
 * 供回复建议 / 客户卡洞察 / 草稿翻译 / 语音转写共用。
 */

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_IMAGE_BASE = "https://generativelanguage.googleapis.com/v1/models";

export const GEMINI_DEFAULT_MODEL = "gemini-2.0-flash";
export const GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image";

async function geminiPost(
  apiKey: string,
  model: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
  onText?: (text: string) => void,
  feature:AiUsageFeature="suggestion",
  vertex?:VertexAiConfig
): Promise<string> {
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(model))throw Error("无效的 Gemini 模型 ID");
  const base=vertex?vertexBaseUrl(vertex):`${GEMINI_BASE}/models`;
  signal?.throwIfAborted();
  const token=vertex?await vertexAccessToken(vertex.vertexCredentialId):"";
  signal?.throwIfAborted();
  return trackAiRequest({provider:vertex?"vertex":"gemini",model,feature,endpoint:vertex?base:undefined},async observe=>{
  const url = `${base}/${model}:${onText ? "streamGenerateContent?alt=sse" : "generateContent"}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(vertex?{Authorization:`Bearer ${token}`}:{"x-goog-api-key":apiKey}),
    },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const err = (await readAiJson(res,observe)) as { error?: { message?: string } };
      detail = err.error?.message || detail;
    } catch {
      /* ignore */
    }
    throw new Error(`Gemini ${res.status}: ${detail}`);
  }
  if (onText) {
    if (!res.body) throw new Error("Gemini 空响应");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "", text = "", bytes = 0, truncated = false;
    const consume = (event: string) => {
      const data = event.split(/\r?\n/).filter(line => line.startsWith("data:"))
        .map(line => line.slice(5).trimStart()).join("\n");
      if (!data || data === "[DONE]") return;
      const chunk = JSON.parse(data);
      observe(chunk);
      if (chunk.error) throw new Error("Gemini 流式响应失败");
      const candidate = chunk.candidates?.[0];
      if (candidate?.finishReason === "MAX_TOKENS") truncated = true;
      if (chunk.promptFeedback?.blockReason || (candidate?.finishReason && !["STOP", "MAX_TOKENS"].includes(candidate.finishReason))) {
        throw new Error("Gemini 回复被阻止或未正常完成");
      }
      const delta = candidate?.content?.parts?.filter((part: { text?: string; thought?: boolean }) => !part.thought)
        .map((part: { text?: string }) => part.text || "").join("") || "";
      if (delta) { text += delta; if (!truncated) onText(text); }
    };
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 1_000_000) throw new Error("Gemini 回复过大");
        buffer += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
          consume(buffer.slice(0, boundary.index));
          buffer = buffer.slice(boundary.index + boundary[0].length);
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) consume(buffer);
      if (truncated) throw new Error(AI_OUTPUT_TRUNCATED);
      if (!text.trim()) throw new Error("Gemini 空响应");
      return text;
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  const data = (await readAiJson(res,observe)) as {
    candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?:boolean }[] } }[];
    promptFeedback?: { blockReason?: string };
  };
  const reason = data.candidates?.[0]?.finishReason;
  if (reason === "MAX_TOKENS") throw new Error(AI_OUTPUT_TRUNCATED);
  if (data.promptFeedback?.blockReason || (reason && reason !== "STOP")) throw new Error("Gemini 回复被阻止或未正常完成");
  const text =
    data.candidates?.[0]?.content?.parts
      ?.filter(part=>!part?.thought).map((part) => part?.text || "")
      .join("") || "";
  if (!text.trim()) throw new Error("Gemini 空响应");
  return text;
  });
}

/** 文本生成（可要求 JSON 输出） */
export async function geminiGenerate(opts: {
  apiKey: string;
  model?: string;
  system?: string;
  user: string;
  temperature?: number;
  json?: boolean;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  onText?: (text: string) => void;
  feature?:AiUsageFeature;
  vertex?:VertexAiConfig;
}): Promise<string> {
  const model = opts.model || (opts.vertex?"":GEMINI_DEFAULT_MODEL);
  const generationConfig: Record<string, unknown> = {
    temperature: opts.temperature ?? 0.7,
  };
  if (opts.json) generationConfig.responseMimeType = "application/json";
  if (opts.maxOutputTokens && opts.maxOutputTokens > 0) {
    generationConfig.maxOutputTokens = opts.maxOutputTokens;
  }
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: opts.user }] }],
    generationConfig,
  };
  if (opts.system?.trim()) {
    body.systemInstruction = { parts: [{ text: opts.system }] };
  }
  return geminiPost(opts.apiKey, model, body, opts.signal, opts.onText,opts.feature,opts.vertex);
}

/** 语音转写：把音频 base64 内联给 Gemini，输出纯文本转写 */
export async function geminiTranscribeAudio(opts: {
  apiKey: string;
  model?: string;
  mimeType: string;
  base64: string;
  signal?: AbortSignal;
}): Promise<string> {
  const model = opts.model || GEMINI_DEFAULT_MODEL;
  const body: Record<string, unknown> = {
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: opts.mimeType, data: opts.base64 } },
          {
            text: "Transcribe this voice message to plain text. Output ONLY the transcript — no quotes, no labels, no explanation.",
          },
        ],
      },
    ],
  };
  return geminiPost(opts.apiKey, model, body, opts.signal,undefined,"transcription");
}

export async function geminiGenerateImage(opts: {
  apiKey: string;
  prompt: string;
  model?: string;
  aspectRatio?: "1:1" | "2:3" | "3:2";
  referenceImage?: { mimeType: string; data: string };
  referenceImages?: { mimeType: string; data: string }[];
  signal?: AbortSignal;
  vertex?: VertexAiConfig;
}): Promise<{ mimeType: string; data: string }> {
  const model = opts.model || GEMINI_IMAGE_MODEL;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(model)) throw Error("无效的 Gemini 图片模型 ID");
  const prompt = opts.prompt.trim();
  if (!prompt || prompt.length > 6000) throw Error("图片描述超出长度限制");
  const references = opts.referenceImages || (opts.referenceImage ? [opts.referenceImage] : []);
  if (references.length > 2 || references.some(image => !/^image\/(?:jpeg|png|webp)$/.test(image.mimeType) || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data) || image.data.length > 4_000_000)) throw Error("参考图片格式无效或过大");
  const base = opts.vertex ? vertexBaseUrl(opts.vertex) : GEMINI_IMAGE_BASE;
  const token = opts.vertex ? await vertexAccessToken(opts.vertex.vertexCredentialId) : "";
  return trackAiRequest({ provider: opts.vertex ? "vertex" : "gemini", model, feature: "image", endpoint: opts.vertex ? base : undefined }, async observe => {
    const res = await fetch(`${base}/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(opts.vertex ? { Authorization: `Bearer ${token}` } : { "x-goog-api-key": opts.apiKey }) },
      body: JSON.stringify({ contents: [{ role: "user", parts: [...references.map(image => ({ inlineData: { mimeType: image.mimeType, data: image.data } })), { text: prompt }] }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: opts.aspectRatio || "1:1" } } }),
      signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      let detail = res.statusText;
      try { const err = await readAiJson(res, observe) as { error?: { message?: string } }; detail = err.error?.message || detail; } catch { /* Keep the HTTP status if the error body is invalid. */ }
      throw Error(`Gemini ${res.status}: ${detail}`);
    }
    const result = await readAiJson(res, observe, 16_000_000) as {
      candidates?: { finishReason?: string; content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[];
      promptFeedback?: { blockReason?: string };
    };
    const reason = result.candidates?.[0]?.finishReason;
    if (result.promptFeedback?.blockReason || reason && !["STOP", "IMAGE_SAFETY"].includes(reason)) throw Error("图片生成被 Gemini 安全规则拦截，请调整描述后重试");
    const image = result.candidates?.[0]?.content?.parts?.find(part => part.inlineData)?.inlineData;
    if (!image || !["image/png", "image/jpeg", "image/webp"].includes(image.mimeType || "") || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data || "") || image.data!.length > Math.ceil(8 * 1024 * 1024 * 4 / 3)) throw Error("Gemini 没有返回有效图片（图片最大 8 MB）");
    return { mimeType: image.mimeType!, data: image.data! };
  });
}
