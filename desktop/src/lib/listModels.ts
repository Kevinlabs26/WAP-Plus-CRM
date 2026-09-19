import type { AppSettings } from "@/store/appStore";
import { getOpenAiCompatibleConfig } from "./aiProviders.ts";

export interface ModelOption {
  id: string;
  label: string;
}

/** 从提供商 API 拉取可用模型列表（供设置页下拉选择）。失败抛错由调用方提示。 */
export async function listProviderModels(
  provider: AppSettings["aiProvider"],
  settings: AppSettings
): Promise<ModelOption[]> {
  switch (provider) {
    case "openai":
      return listOpenAiCompatible(
        "https://api.openai.com/v1/models",
        settings.openaiKey,
        "OpenAI"
      );
    case "groq":
      return listOpenAiCompatible(
        "https://api.groq.com/openai/v1/models",
        settings.groqKey,
        "Groq"
      );
    case "gemini":
      return listGeminiModels(settings.geminiKey);
    case "ollama":
      return listOllamaModels(settings.ollamaUrl);
    default:
      {
        const config = getOpenAiCompatibleConfig(settings);
        if (!config?.baseUrl || !config.apiKey) return [];
        // baseUrl 是 OpenAI 兼容根（…/v1、…/v4），必须拼上 /models；
        // 直接请求根路径会 404，导致 DeepSeek/通义/智谱/OpenRouter/自定义
        // 五类 provider 的「获取模型列表」必然失败。
        const base = config.baseUrl.replace(/\/+$/, "");
        const url = /\/models$/.test(base) ? base : `${base}/models`;
        return listOpenAiCompatible(url, config.apiKey, config.label);
      }
  }
}

async function listOpenAiCompatible(
  url: string,
  apiKey: string,
  label: string
): Promise<ModelOption[]> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${label} 无法读取模型列表（${res.status}）`);
  const data = (await res.json()) as { data?: { id?: string }[] };
  const ids = [
    ...new Set(
      (data.data || []).map((m) => m.id).filter((id): id is string => Boolean(id))
    ),
  ].sort();
  return ids.map((id) => ({ id, label: id }));
}

async function listGeminiModels(apiKey: string): Promise<ModelOption[]> {
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models",
    {
      headers: { "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(30_000),
    }
  );
  if (!res.ok) throw new Error(`Gemini 无法读取模型列表（${res.status}）`);
  const data = (await res.json()) as {
    models?: { name?: string; supportedGenerationMethods?: string[] }[];
  };
  return (data.models || [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => ({
      id: (m.name || "").replace(/^models\//, ""),
      label: m.name || "",
    }))
    .filter((m): m is ModelOption => Boolean(m.id))
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function listOllamaModels(base: string): Promise<ModelOption[]> {
  const res = await fetch(`${base.replace(/\/$/, "")}/api/tags`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Ollama 无法读取模型列表（${res.status}）`);
  const data = (await res.json()) as { models?: { name?: string }[] };
  return (data.models || [])
    .map((m) => ({ id: m.name || "", label: m.name || "" }))
    .filter((m) => m.id)
    .sort((a, b) => a.id.localeCompare(b.id));
}
