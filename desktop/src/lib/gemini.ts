/**
 * Gemini API 调用（Google 官方 generateContent 接口，非 OpenAI 兼容）。
 * 供回复建议 / 客户卡洞察 / 草稿翻译 / 语音转写共用。
 */

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export const GEMINI_DEFAULT_MODEL = "gemini-2.0-flash";

async function geminiPost(
  apiKey: string,
  model: string,
  body: Record<string, unknown>
): Promise<string> {
  const url = `${GEMINI_BASE}/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
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
  return geminiPost(opts.apiKey, model, body);
}

/** 语音转写：把音频 base64 内联给 Gemini，输出纯文本转写 */
export async function geminiTranscribeAudio(opts: {
  apiKey: string;
  model?: string;
  mimeType: string;
  base64: string;
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
  return geminiPost(opts.apiKey, model, body);
}
