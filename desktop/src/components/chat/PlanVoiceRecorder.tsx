import { useEffect, useRef, useState } from "react";
import { Mic, Square, X } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useI18n } from "@/i18n";
import { canRecordVoice, startVoiceRecording } from "@/lib/voiceRecord";
import type { ScheduledPlan } from "@/lib/scheduledPlans";

export function PlanVoiceRecorder({ disabled, onBusyChange, onRecorded }: {
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onRecorded: (media: NonNullable<ScheduledPlan["media"]>) => void;
}) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<"idle" | "starting" | "recording" | "stopping">("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const session = useRef<Awaited<ReturnType<typeof startVoiceRecording>> | null>(null);
  const request = useRef(0);
  const working = useRef(false);
  const stopping = useRef(false);
  useEffect(() => () => {
    request.current++;
    session.current?.cancel(); session.current = null;
    if (working.current) onBusyChange(false);
  }, [onBusyChange]);
  useEffect(() => {
    if (phase !== "recording") return;
    const timer = window.setInterval(() => {
      const elapsed = session.current?.durationSec() || 0;
      setSeconds(elapsed);
      // Leave a second for recorder shutdown before the bridge's 10-minute limit.
      if (elapsed >= 599) void finish();
    }, 200);
    return () => window.clearInterval(timer);
  }, [phase]);

  function idle() { working.current = false; stopping.current = false; setPhase("idle"); onBusyChange(false); }
  function cancel() { request.current++; session.current?.cancel(); session.current = null; idle(); }
  async function begin() {
    if (disabled || working.current) return;
    setError("");
    if (!canRecordVoice()) { setError(t("runtime.recordDesktopMic")); return; }
    const id = ++request.current;
    working.current = true; setPhase("starting"); setSeconds(0); onBusyChange(true);
    try {
      const recorder = await startVoiceRecording();
      if (id !== request.current) { recorder.cancel(); return; }
      session.current = recorder; setPhase("recording");
    } catch (e) {
      if (id !== request.current) return;
      setError(e instanceof Error ? e.message : t("runtime.recordStartFailed")); idle();
    }
  }
  async function finish() {
    if (!session.current || stopping.current) return;
    const id = request.current;
    stopping.current = true; setPhase("stopping");
    try {
      const result = await session.current.stop();
      if (id !== request.current) return;
      if (result.durationSec < 1 || result.byteLength < 200) throw new Error(t("runtime.recordTooShort"));
      if (result.durationSec > 600) throw new Error(t("planQueue.voiceLimit"));
      if (result.byteLength > 8 * 1024 * 1024) throw new Error(t("settingsQuickReplies.mediaTooLarge"));
      const extension = result.mimeType.includes("ogg") ? "ogg" : result.mimeType.includes("mp4") ? "m4a" : "webm";
      onRecorded({ kind: "audio", dataUrl: result.dataUrl, mimeType: result.mimeType, size: result.byteLength, fileName: `voice-${Date.now()}.${extension}` });
    } catch (e) {
      if (id === request.current) setError(e instanceof Error ? e.message : t("runtime.recordStartFailed"));
    } finally {
      if (id === request.current) { session.current?.cancel(); session.current = null; idle(); }
    }
  }
  return <div className="space-y-1">
    {phase === "idle" ? <Button size="sm" disabled={disabled} onClick={() => void begin()} className="inline-flex items-center gap-1.5"><Mic aria-hidden="true" className="h-4 w-4" />{t("planQueue.recordVoice")}</Button> : <div className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-400/30 bg-rose-400/5 p-2">
      <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" aria-hidden="true" />
      <span className="font-mono text-xs tabular-nums" role="timer">{phase === "starting" ? t("planQueue.voiceStarting") : phase === "stopping" ? t("voice.inputBusy") : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}</span>
      {phase === "recording" && <Button size="sm" onClick={() => void finish()} className="inline-flex items-center gap-1.5"><Square aria-hidden="true" className="h-3 w-3" />{t("voice.finishPreview")}</Button>}
      <Button size="sm" variant="ghost" disabled={phase === "stopping"} aria-label={t("tooltip.deleteRecording")} title={t("tooltip.deleteRecording")} onClick={cancel}><X aria-hidden="true" className="h-4 w-4" /></Button>
    </div>}
    {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}
  </div>;
}
