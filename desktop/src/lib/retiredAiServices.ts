import type { SettingsShape } from "@/store/settingsDefaults";

// Keep only migration/rejection identifiers so saved custom presets cannot reconnect.
const RETIRED_HOSTS = ["deepseek.com", "aliyuncs.com", "bigmodel.cn", "moonshot.cn", "siliconflow.cn"];
export function isRetiredAiEndpoint(raw: unknown): boolean {
  try {
    const host = new URL(String(raw)).hostname.toLowerCase().replace(/\.$/, "");
    return host.endsWith(".cn") || RETIRED_HOSTS.some(domain => host === domain || host.endsWith(`.${domain}`));
  } catch { return false; }
}
export function isRetiredAiModel(raw: unknown): boolean {
  return /(?:^|\/)(?:deepseek|qwen|qwq|glm|chatglm|moonshot|kimi)(?:\d|[-/_.:]|$)/i.test(String(raw || ""));
}

export function stripRetiredAiSettings(settings: Partial<SettingsShape>): void {
  for (const key of ["deepseekKey", "qwenKey", "zhipuKey"]) delete (settings as Record<string, unknown>)[key];
  const customRemoved = isRetiredAiEndpoint(settings.customAiBaseUrl) || isRetiredAiModel(settings.customAiModel);
  const ollamaRemoved = isRetiredAiEndpoint(settings.ollamaUrl);
  if (settings.aiProvider && (!["mock", "openai", "groq", "openrouter", "gemini", "muse", "ollama", "custom"].includes(settings.aiProvider)
      || settings.aiProvider === "custom" && customRemoved || settings.aiProvider === "ollama" && ollamaRemoved
      || settings.aiProvider !== "muse" && isRetiredAiModel(settings.aiModel))) {
    settings.aiProvider = "mock";
    settings.aiModel = "";
    settings.aiReplyMode = "semi";
    settings.aiAutoReplyPaused = true;
    settings.aiAutoFollowUpEnabled = false;
  }
  if (customRemoved) {
    settings.customAiBaseUrl = "";
    settings.customAiModel = "";
    settings.customAiKey = "";
  }
  if (ollamaRemoved) settings.ollamaUrl = "http://127.0.0.1:11434";
  if (isRetiredAiEndpoint(settings.translationBaseUrl) || isRetiredAiModel(settings.translationModel)
      || settings.translationProvider && !["mock", "openai", "groq", "openrouter", "gemini", "ollama", "custom"].includes(settings.translationProvider)) {
    settings.translationProvider = "mock";
    settings.translationBaseUrl = "";
    settings.translationModel = "";
    settings.translationApiKey = "";
  }
  if (isRetiredAiEndpoint(settings.transcriptionBaseUrl) || isRetiredAiModel(settings.transcriptionModel)) {
    settings.transcriptionProvider = "none";
    settings.transcriptionBaseUrl = "";
    settings.transcriptionModel = "";
    settings.transcriptionApiKey = "";
  }
}
