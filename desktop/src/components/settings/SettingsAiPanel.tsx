import { useAppStore } from "@/store/appStore";
import { Input, SectionLabel } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  listProviderModels,
  type ModelOption,
} from "@/lib/listModels";
import type { AppSettings } from "@/store/appStore";
import { getOpenAiCompatibleConfig, hasAiCredentials } from "@/lib/aiProviders.ts";
import { useI18n } from "@/i18n";
import { TimeZoneSelect } from "@/components/ui/TimeZoneSelect";
import { systemTimeZone } from "@/lib/timeZone";
import { isChatModel, type ModelPurpose } from "@/lib/modelCapabilities";

export function SettingsAiPanel() {
  const { t } = useI18n();
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h3 className="text-lg font-semibold text-zinc-100">{t("settingsAi.title")}</h3>
        <p className="mt-1 text-[11px] text-zinc-500">{t("settingsAi.description")}</p>
      </header>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
        <SectionLabel>{t("settingsAi.modelService")}</SectionLabel>
        <AiServiceFields settings={settings} updateSettings={updateSettings} />
        <p className="mt-3 text-2xs text-zinc-600">{t("settingsAi.keyHint")}</p>
        <div className="mt-3">
          <TimeZoneSelect value={settings.aiTimeZone} onChange={aiTimeZone => updateSettings({ aiTimeZone })}
            label={t("settingsAi.myTimeZone")} automatic={t("settingsAi.computerTimeZone", { zone: systemTimeZone() || "UTC" })} />
        </div>
      </section>
    </div>
  );
}

export function AiServiceFields({ settings, updateSettings, showMockHint = true }: { settings: AppSettings; updateSettings: (patch: Partial<AppSettings>) => void; showMockHint?: boolean }) {
  const { t } = useI18n();
  return (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="col-span-2 block text-2xs text-zinc-500">
            {t("settingsAi.provider")}
            <select
              value={settings.aiProvider}
              onChange={(event) => updateSettings({ aiProvider: event.target.value as typeof settings.aiProvider, aiModel: "" })}
              className="ui-control mt-1 w-full px-2.5 text-[13px]"
            >
              <option value="mock">{t("settingsAi.provider.mock")}</option>
              <option value="openai">OpenAI</option>
              <option value="groq">Groq</option>
              <option value="deepseek">DeepSeek</option>
              <option value="qwen">Qwen</option>
              <option value="zhipu">Zhipu GLM</option>
              <option value="openrouter">OpenRouter</option>
              <option value="gemini">Gemini</option>
              <option value="custom">{t("settingsAi.provider.custom")}</option>
              <option value="ollama">{t("settingsAi.provider.ollama")}</option>
            </select>
          </label>

          {settings.aiProvider === "mock" && showMockHint && (
            <p className="col-span-2 rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-3 py-2 text-2xs leading-4 text-zinc-500">
              {t("settingsAi.mockHint")}
            </p>
          )}
          {settings.aiProvider === "openai" && (
            <SecretInput full label="OpenAI API Key" value={settings.openaiKey} placeholder="sk-…" onChange={(value) => updateSettings({ openaiKey: value })} />
          )}
          {settings.aiProvider === "groq" && (
            <SecretInput full label="Groq API Key" value={settings.groqKey} placeholder="gsk_…" onChange={(value) => updateSettings({ groqKey: value })} />
          )}
          {settings.aiProvider === "deepseek" && (
            <SecretInput full label="DeepSeek API Key" value={settings.deepseekKey} placeholder="sk-…" onChange={(value) => updateSettings({ deepseekKey: value })} />
          )}
          {settings.aiProvider === "qwen" && (
            <SecretInput full label="Qwen API Key" value={settings.qwenKey} placeholder="sk-…" onChange={(value) => updateSettings({ qwenKey: value })} />
          )}
          {settings.aiProvider === "zhipu" && (
            <SecretInput full label="Zhipu GLM API Key" value={settings.zhipuKey} placeholder="…" onChange={(value) => updateSettings({ zhipuKey: value })} />
          )}
          {settings.aiProvider === "openrouter" && (
            <SecretInput full label="OpenRouter API Key" value={settings.openrouterKey} placeholder="sk-or-v1-…" onChange={(value) => updateSettings({ openrouterKey: value })} />
          )}
          {settings.aiProvider === "gemini" && (
            <SecretInput full label="Gemini API Key" value={settings.geminiKey} placeholder="AIza…" onChange={(value) => updateSettings({ geminiKey: value })} />
          )}
          {settings.aiProvider === "custom" && (
            <>
              <label className="col-span-2 block text-2xs text-zinc-500">
                {t("settingsAi.presets")}
                <select
                  value=""
                  onChange={(event) => {
                    const preset = CUSTOM_PRESETS[event.target.value];
                    if (preset)
                      updateSettings({
                        customAiBaseUrl: preset.baseUrl,
                        customAiModel: preset.model,
                      });
                  }}
                  className="ui-control mt-1 w-full px-2.5 text-[13px]"
                >
                  <option value="">{t("settingsAi.selectPreset")}</option>
                  {Object.entries(CUSTOM_PRESETS).map(([key, preset]) => (
                    <option key={key} value={key}>{preset.label}</option>
                  ))}
                </select>
              </label>
              <label className="block text-2xs text-zinc-500">
                Base URL
                <Input value={settings.customAiBaseUrl} onChange={(event) => updateSettings({ customAiBaseUrl: event.target.value })} className="mt-1" placeholder="https://api.deepseek.com/v1" />
              </label>
              <SecretInput label="API Key" value={settings.customAiKey} placeholder="sk-…" onChange={(value) => updateSettings({ customAiKey: value })} />
              <label className="block text-2xs text-zinc-500">
                {t("settingsAi.chatModel")}
                <Input value={settings.customAiModel} onChange={(event) => updateSettings({ customAiModel: event.target.value })} className="mt-1" placeholder="deepseek-chat" />
              </label>
            </>
          )}
          {settings.aiProvider === "ollama" && (
            <label className="col-span-2 block text-2xs text-zinc-500">
              Ollama Base URL
              <Input value={settings.ollamaUrl} onChange={(event) => updateSettings({ ollamaUrl: event.target.value })} className="mt-1" placeholder="http://127.0.0.1:11434" />
            </label>
          )}

          {(settings.aiProvider === "openai" ||
            settings.aiProvider === "groq" ||
            settings.aiProvider === "deepseek" ||
            settings.aiProvider === "qwen" ||
            settings.aiProvider === "zhipu" ||
            settings.aiProvider === "openrouter" ||
            settings.aiProvider === "gemini" ||
            settings.aiProvider === "ollama") && (
            <ModelPicker
              settings={settings}
              onModelChange={(model) => updateSettings({ aiModel: model })}
            />
          )}


        </div>
  );
}

function SecretInput({
  label,
  value,
  placeholder,
  onChange,
  full,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  /** 全宽（默认半宽，供 custom 两列并排） */
  full?: boolean;
}) {
  return (
    <label className={cn("block text-2xs text-zinc-500", full && "col-span-2")}>
      {label}
      <Input type="password" value={value} onChange={(event) => onChange(event.target.value)} className="mt-1" placeholder={placeholder} autoComplete="off" />
    </label>
  );
}

/** 从提供商 API 读取可用模型，下拉选择；支持自定义手动输入。 */
export function ModelPicker({
  settings,
  onModelChange,
  purpose = "chat",
}: {
  settings: AppSettings;
  onModelChange: (model: string) => void;
  purpose?: ModelPurpose;
}) {
  const { t } = useI18n();
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [manual, setManual] = useState(false);
  const [loadedFor, setLoadedFor] = useState("");
  const requestGeneration = useRef(0);

  const hasKey = hasAiCredentials(settings);
  const providerConfig = getOpenAiCompatibleConfig(settings);

  const load = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setModels([]); setLoadedFor("");
    if (!hasKey) { setError(""); setLoading(false); return; }
    setLoading(true);
    setError("");
    try {
      const list = await listProviderModels(settings.aiProvider, settings, purpose);
      if (generation !== requestGeneration.current) return;
      setModels(list);
      setLoadedFor(settings.aiProvider);
    } catch (e) {
      if (generation !== requestGeneration.current) return;
      setModels([]);
      setError(e instanceof Error ? e.message : t("settingsAi.modelListFailed"));
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [settings.aiProvider, hasKey, providerConfig?.apiKey, providerConfig?.baseUrl, settings.geminiKey, settings.ollamaUrl, purpose, t]);

  useEffect(() => {
    setManual(false);
    void load();
    return () => { requestGeneration.current++; };
  }, [load]);

  const value = settings.aiModel || "";
  const isManualChosen =
    value && !models.some((m) => m.id === value) && loadedFor === settings.aiProvider;

  return (
    <label className="col-span-2 block text-2xs text-zinc-500">
      {t(purpose === "transcription" ? "settingsAi.speechModel" : "settingsAi.modelOptional")}
      {manual || isManualChosen ? (
        <Input
          value={value}
          onChange={(event) => onModelChange(event.target.value)}
          className="mt-1"
          placeholder={purpose === "transcription" ? "whisper-large-v3-turbo" : "Model ID"}
        />
      ) : (
        <div className="mt-1 flex gap-2">
          <select
            disabled={loading}
            value={value}
            onChange={(event) => {
              if (event.target.value === "__manual__") {
                setManual(true);
                return;
              }
              setManual(false);
              onModelChange(event.target.value);
            }}
            className="ui-control w-full px-2.5 text-[13px]"
          >
            <option value="">{t("settingsAi.defaultModel")}</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
            <option value="__manual__">{t("settingsAi.customModel")}</option>
          </select>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="shrink-0 rounded-lg border border-zinc-700 px-2.5 text-[13px] text-zinc-300 hover:border-brand/50 disabled:opacity-50"
          >
            {loading ? "…" : t("settingsAi.loadModels")}
          </button>
        </div>
      )}
      {error && (
        <p className="mt-1 text-2xs leading-4 text-amber-300">
          {t("settingsAi.loadFailed", { error })}
        </p>
      )}
      {purpose === "chat" && value && !isChatModel(value) && <p role="alert" className="mt-1 text-xs text-amber-300">{t("settingsAi.textModelOnly")}</p>}
      <p className="mt-1 text-2xs leading-4 text-zinc-600">
        {t("settingsAi.modelHint")}
      </p>
    </label>
  );
}

const CUSTOM_PRESETS: Record<
  string,
  { label: string; baseUrl: string; model: string }
> = {
  deepseek: {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
  },
  moonshot: {
    label: "Kimi / Moonshot",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "moonshot-v1-8k",
  },
  qwen: {
    label: "Qwen (Alibaba)",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
  },
  zhipu: {
    label: "Zhipu GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4-flash",
  },
  openrouter: {
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
  },
  siliconflow: {
    label: "SiliconFlow",
    baseUrl: "https://api.siliconflow.cn/v1",
    model: "deepseek-ai/DeepSeek-V3",
  },
  custom: {
    label: "Custom OpenAI-compatible endpoint",
    baseUrl: "",
    model: "",
  },
};
