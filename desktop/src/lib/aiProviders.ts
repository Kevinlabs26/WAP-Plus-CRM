import type { AppSettings } from "@/store/types";

export type OpenAiCompatibleProvider =
  | "openai"
  | "groq"
  | "deepseek"
  | "qwen"
  | "zhipu"
  | "openrouter"
  | "custom";

export interface OpenAiCompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  label: string;
}

export function chatCompletionOptions(provider:string,model:string,temperature:number,maxTokens?:number) {
  const openai=provider==="openai";
  const reasoning=/^(?:gpt-(?:[5-9]|\d{2,})(?:[.-]|$)|o\d+(?:-|$))/i.test(model);
  // Luna supports none: keep the small chat budget available for the visible reply.
  const fast=openai&&/^gpt-5\.6-luna(?:-|$)/i.test(model);
  return {
    ...(!openai||!reasoning||fast?{temperature}:{}),
    ...(fast?{reasoning_effort:"none" as const}:{}),
    ...(maxTokens===undefined?{}:openai?{max_completion_tokens:maxTokens}:{max_tokens:maxTokens}),
  };
}

export function getOpenAiCompatibleConfig(
  settings: Partial<AppSettings>
): OpenAiCompatibleConfig | null {
  switch (settings.aiProvider) {
    case "openai":
      return {
        baseUrl: "https://api.openai.com/v1",
        apiKey: settings.openaiKey || "",
        model: (settings.aiModel || "").trim() || "gpt-4o-mini",
        label: "OpenAI",
      };
    case "groq":
      return {
        baseUrl: "https://api.groq.com/openai/v1",
        apiKey: settings.groqKey || "",
        model: (settings.aiModel || "").trim() || "llama-3.3-70b-versatile",
        label: "Groq",
      };
    case "deepseek":
      return {
        baseUrl: "https://api.deepseek.com/v1",
        apiKey: settings.deepseekKey || "",
        model: (settings.aiModel || "").trim() || "deepseek-chat",
        label: "DeepSeek",
      };
    case "qwen":
      return {
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: settings.qwenKey || "",
        model: (settings.aiModel || "").trim() || "qwen-plus",
        label: "通义千问",
      };
    case "zhipu":
      return {
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        apiKey: settings.zhipuKey || "",
        model: (settings.aiModel || "").trim() || "glm-4-flash",
        label: "智谱 GLM",
      };
    case "openrouter":
      return {
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: settings.openrouterKey || "",
        model: (settings.aiModel || "").trim() || "openai/gpt-4o-mini",
        label: "OpenRouter",
      };
    case "custom":
      return {
        baseUrl: settings.customAiBaseUrl || "",
        apiKey: settings.customAiKey || "",
        model: (settings.customAiModel || "").trim(),
        label: "自定义",
      };
    default:
      return null;
  }
}

export function hasAiCredentials(settings: AppSettings): boolean {
  if(settings.aiProvider==="muse")return true; // The native adapter checks the browser session on every request.
  if(settings.aiProvider==="vertex")return !!settings.vertexCredentialId&&!!settings.vertexProjectId&&!!settings.vertexLocation&&!!settings.aiModel?.trim();
  if (settings.aiProvider === "gemini") return !!settings.geminiKey?.trim();
  if (settings.aiProvider === "ollama") return !!settings.ollamaUrl?.trim();
  const config = getOpenAiCompatibleConfig(settings);
  return !!config?.apiKey?.trim() &&
    (settings.aiProvider !== "custom" || !!config.baseUrl?.trim());
}
