import { readAiJson } from "./aiResponse.ts";
import { trackAiRequest } from "./aiUsage.ts";

export const OPENAI_IMAGE_MODEL = "gpt-image-2.5-flare";

export async function openAiGenerateImage(apiKey: string, prompt: string, aspectRatio: "1:1" | "2:3" | "3:2" = "1:1", referenceImage?: string | string[]): Promise<{ mimeType: string; data: string }> {
  if (!apiKey.trim()) throw Error("请先配置 OpenAI API Key");
  if (!prompt.trim() || prompt.length > 6000) throw Error("图片描述超出长度限制");
  const references = Array.isArray(referenceImage) ? referenceImage : referenceImage ? [referenceImage] : [];
  if (references.length > 2 || references.some(image => !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image) || image.length > 4_000_000)) throw Error("参考图片格式无效或过大");
  return trackAiRequest({ provider: "openai", model: OPENAI_IMAGE_MODEL, feature: "image" }, async observe => {
    const response = await fetch(`https://api.openai.com/v1/images/${references.length ? "edits" : "generations"}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey.trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: OPENAI_IMAGE_MODEL, prompt: prompt.trim(), n: 1, ...(references.length ? { images: references.map(image_url => ({ image_url })) } : {}), size: aspectRatio === "2:3" ? "1024x1536" : aspectRatio === "3:2" ? "1536x1024" : "1024x1024", quality: "medium", output_format: "png" }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      let detail = response.statusText;
      try { const error = await readAiJson(response, observe) as { error?: { message?: string } }; detail = error.error?.message || detail; } catch { /* Keep the HTTP status if the error body is invalid. */ }
      throw Error(`OpenAI ${response.status}: ${detail}`);
    }
    const result = await readAiJson(response, observe, 16_000_000) as { data?: { b64_json?: string }[] };
    const data = result.data?.[0]?.b64_json;
    if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length > Math.ceil(8 * 1024 * 1024 * 4 / 3)) throw Error("OpenAI 没有返回有效图片（图片最大 8 MB）");
    return { mimeType: "image/png", data };
  });
}
