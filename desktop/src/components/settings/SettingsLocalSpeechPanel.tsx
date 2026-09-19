import { useCallback, useEffect, useState } from "react";
import { Check, Download, HardDriveDownload, Loader2, Trash2 } from "lucide-react";

function useSystemVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    const load = () => setVoices(window.speechSynthesis?.getVoices() ?? []);
    load();
    window.speechSynthesis?.addEventListener?.("voiceschanged", load);
    return () =>
      window.speechSynthesis?.removeEventListener?.("voiceschanged", load);
  }, []);
  return voices;
}
import { Button, SectionLabel } from "@/components/ui/primitives";
import { useAppStore } from "@/store/appStore";
import {
  SPEECH_MODEL_PRESETS,
  downloadSpeechModel,
  listLocalSpeechModels,
  removeLocalSpeechModel,
  type SpeechModelInfo,
} from "@/lib/localSpeech";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

/**
 * 本地语音识别模型管理：下载 / 就绪状态 / 删除。
 * 模型就绪后，语音消息「转文字」自动优先离线识别（零 Key 零配额）。
 */
export function SettingsLocalSpeechPanel() {
  const { t } = useI18n();
  const modelCopy = (id: string) => id.includes("tiny")
    ? { label: t("settingsSpeech.modelTiny"), detail: t("settingsSpeech.modelTinyDetail") }
    : { label: t("settingsSpeech.modelBase"), detail: t("settingsSpeech.modelBaseDetail") };
  const pushToast = useAppStore((s) => s.pushToast);
  const systemVoices = useSystemVoices();
  const [models, setModels] = useState<SpeechModelInfo[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ id: string; pct: number } | null>(
    null
  );

  const refresh = useCallback(async () => {
    setModels(await listLocalSpeechModels());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleDownload = async (preset: (typeof SPEECH_MODEL_PRESETS)[number]) => {
    if (busyId) return;
    setBusyId(preset.id);
    setProgress({ id: preset.id, pct: 0 });
    try {
      await downloadSpeechModel(preset, (received, total) => {
        const pct = total > 0 ? Math.round((received / total) * 100) : Math.min(99, Math.round(received / 1024 / 1024));
        setProgress({ id: preset.id, pct });
      });
      await refresh();
      pushToast(t("settingsSpeech.readyToast", { model: modelCopy(preset.id).label }), "success");
    } catch (e) {
      pushToast(e instanceof Error ? e.message : t("settingsSpeech.downloadFailed"), "error");
    } finally {
      setBusyId(null);
      setProgress(null);
    }
  };

  const handleRemove = async (model: SpeechModelInfo) => {
    if (busyId) return;
    setBusyId(model.name);
    try {
      await removeLocalSpeechModel(model.name);
      await refresh();
      pushToast(t("settingsSpeech.deleted"), "info");
    } catch (e) {
      pushToast(e instanceof Error ? e.message : t("common.deleteFailed"), "error");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h3 className="text-[15px] font-semibold text-zinc-100">{t("settingsSpeech.title")}</h3>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">
          {t("settingsSpeech.description")}
        </p>
      </div>

      <section>
        <SectionLabel>{t("settingsSpeech.presets")}</SectionLabel>
        <div className="space-y-2">
          {SPEECH_MODEL_PRESETS.map((preset) => {
            const installed = models.some((m) => m.name === preset.id && m.ready);
            const busy = busyId === preset.id;
            const pct = progress?.id === preset.id ? progress.pct : null;
            return (
              <div
                key={preset.id}
                className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2.5"
              >
                <HardDriveDownload className="h-4 w-4 shrink-0 text-zinc-500" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[13px] font-medium text-zinc-200">
                    {modelCopy(preset.id).label}
                    {installed && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-2xs text-emerald-400">
                        <Check className="h-3 w-3" />
                        {t("settingsSpeech.ready")}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-2xs text-zinc-600">
                    {modelCopy(preset.id).detail}
                  </div>
                  {pct !== null && (
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-brand transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </div>
                <Button
                  variant={installed ? "ghost" : "secondary"}
                  disabled={!!busyId}
                  className="!min-h-7 shrink-0 gap-1 !px-2 text-2xs"
                  onClick={() => void handleDownload(preset)}
                >
                  {busy ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {pct !== null ? `${pct}%` : t("settingsSpeech.preparing")}
                    </>
                  ) : (
                    <>
                      <Download className="h-3 w-3" />
                      {installed ? t("settingsSpeech.redownload") : t("common.download")}
                    </>
                  )}
                </Button>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <SectionLabel>{t("settingsSpeech.ttsVoices")}</SectionLabel>
        {systemVoices.length === 0 ? (
          <p className="text-2xs text-zinc-600">
            {t("settingsSpeech.noVoices")}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {systemVoices.map((voice) => (
              <div
                key={voice.name}
                className="truncate rounded-md border border-zinc-800/70 px-2 py-1.5 text-2xs"
                title={voice.name}
              >
                <span className="font-mono text-zinc-500">{voice.lang}</span>
                <span className="ml-1.5 text-zinc-400">{voice.name}</span>
              </div>
            ))}
          </div>
        )}
        <p className="mt-1.5 text-2xs leading-snug text-zinc-600">
          {t("settingsSpeech.voiceHint")}
        </p>
      </section>

      {models.length > 0 && (
        <section>
          <SectionLabel>{t("settingsSpeech.localDirectory")}</SectionLabel>
          <div className="space-y-2">
            {models.map((model) => (
              <div
                key={model.name}
                className="flex items-center gap-3 rounded-lg border border-zinc-800/70 px-3 py-2"
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    model.ready ? "bg-emerald-400" : "bg-zinc-600"
                  )}
                />
                <span className="min-w-0 flex-1 truncate font-mono text-2xs text-zinc-400">
                  {model.dir}
                </span>
                <Button
                  variant="ghost"
                  disabled={!!busyId}
                  className="!min-h-6 w-7 !px-0 text-zinc-500 hover:!text-red-400"
                  title={t("settingsSpeech.deleteModel")}
                  onClick={() => void handleRemove(model)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
