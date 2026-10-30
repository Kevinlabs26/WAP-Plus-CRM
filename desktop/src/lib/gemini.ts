/**
 * Gemini API 调用（Google 官方 generateContent 接口，非 OpenAI 兼容）。
 * 供回复建议 / 客户卡洞察 / 草稿翻译 / 语音转写共用。
 */

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export const GEMINI_DEFAULT_MODEL = "gemini-2.0-flash";

async function geminiPost(
  apiKey: string,
  model: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
  onText?: (text: string) => void
): Promise<string> {
  const url = `${GEMINI_BASE}/models/${model}:${onText ? "streamGenerateContent?alt=sse" : "generateContent"}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const err = (await res.json()) as { error?: { message?: string } };
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
    let buffer = "", text = "", bytes = 0;
    const consume = (event: string) => {
      const data = event.split(/\r?\n/).filter(line => line.startsWith("data:"))
        .map(line => line.slice(5).trimStart()).join("\n");
      if (!data || data === "[DONE]") return;
      const chunk = JSON.parse(data);
      if (chunk.error) throw new Error("Gemini 流式响应失败");
      const candidate = chunk.candidates?.[0];
      if (chunk.promptFeedback?.blockReason || (candidate?.finishReason && !["STOP", "MAX_TOKENS"].includes(candidate.finishReason))) {
        throw new Error("Gemini 回复被阻止或未正常完成");
      }
      const delta = candidate?.content?.parts?.filter((part: { text?: string; thought?: boolean }) => !part.thought)
        .map((part: { text?: string }) => part.text || "").join("") || "";
      if (delta) { text += delta; onText(text); }
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
      if (!text.trim()) throw new Error("Gemini 空响应");
      return text;
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text =
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part?.text || "")
      .join("") || "";
  if (!text.trim()) throw new Error("Gemini 空响应");
  return text;
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
}): Promise<string> {
  const model = opts.model || GEMINI_DEFAULT_MODEL;
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
  return geminiPost(opts.apiKey, model, body, opts.signal, opts.onText);
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
  return geminiPost(opts.apiKey, model, body, opts.signal);
}
