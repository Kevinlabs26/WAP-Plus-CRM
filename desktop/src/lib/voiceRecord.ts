/** 浏览器按住录音 → data URL（优先 Ogg/Opus，其次 webm） */

export type VoiceRecordResult = {
  dataUrl: string;
  mimeType: string;
  /** 秒 */
  durationSec: number;
  byteLength: number;
};

function pickMime(): string {
  const candidates = [
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ];
  for (const t of candidates) {
    if (
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported(t)
    ) {
      return t;
    }
  }
  return "";
}

export function canRecordVoice(): boolean {
  return (
    typeof window !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined"
  );
}

export function preferredVoiceMime(): string {
  return pickMime() || "audio/webm";
}

export function voiceDurationSeconds(elapsedMs: number): number {
  return Math.floor(Math.max(0, elapsedMs) / 1000);
}

export function voiceSignalLevel(samples: Uint8Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (const sample of samples) {
    const amplitude = (sample - 128) / 128;
    sum += amplitude * amplitude;
  }
  return Math.min(1, Math.sqrt(sum / samples.length) * 4);
}

/**
 * 开始录音。返回 stop()：停止并得到 dataUrl。
 * cancel()：丢弃不上传。
 */
export async function startVoiceRecording(): Promise<{
  mimeType: string;
  stop: () => Promise<VoiceRecordResult>;
  cancel: () => void;
  pause: () => void;
  resume: () => void;
  durationSec: () => number;
  level: () => number;
}> {
  if (!canRecordVoice()) {
    throw new Error("当前环境不支持录音（需桌面壳与麦克风权限）");
  }
  const mimeType = preferredVoiceMime();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      channelCount: 1,
    },
  });
  let audioContext: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let levelSamples: Uint8Array<ArrayBuffer> | null = null;
  try {
    audioContext = new AudioContext();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.72;
    levelSamples = new Uint8Array(new ArrayBuffer(analyser.fftSize));
    audioContext.createMediaStreamSource(stream).connect(analyser);
    void audioContext.resume();
  } catch {
    audioContext = null;
    analyser = null;
    levelSamples = null;
  }
  const stopMeter = () => {
    const context = audioContext;
    audioContext = null;
    analyser = null;
    levelSamples = null;
    if (context && context.state !== "closed") {
      void context.close().catch(() => undefined);
    }
  };
  const chunks: BlobPart[] = [];
  const recorder = mimeType
    ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 24000 })
    : new MediaRecorder(stream, { audioBitsPerSecond: 24000 });
  const actualMime = recorder.mimeType || mimeType || "audio/webm";
  const startedAt = Date.now();
  let pausedAt: number | null = null;
  let pausedMs = 0;
  const elapsedMs = () =>
    Date.now() -
    startedAt -
    pausedMs -
    (pausedAt == null ? 0 : Date.now() - pausedAt);

  recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) chunks.push(ev.data);
  };

  let finished: {
    resolve: (r: VoiceRecordResult) => void;
    reject: (e: unknown) => void;
  } | null = null;

  recorder.onerror = () => {
    finished?.reject(new Error("录音失败"));
    finished = null;
  };

  recorder.onstop = async () => {
    try {
      stream.getTracks().forEach((t) => t.stop());
      stopMeter();
      const blob = new Blob(chunks, { type: actualMime });
      if (!blob.size) {
        finished?.reject(new Error("没有录到声音"));
        finished = null;
        return;
      }
      const durationSec = voiceDurationSeconds(elapsedMs());
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取录音失败"));
        reader.readAsDataURL(blob);
      });
      finished?.resolve({
        dataUrl,
        mimeType: actualMime,
        durationSec,
        byteLength: blob.size,
      });
    } catch (e) {
      finished?.reject(e);
    } finally {
      finished = null;
    }
  };

  // 周期性 data，避免部分浏览器只在 stop 才给一大块
  recorder.start(250);

  return {
    mimeType: actualMime,
    stop: () =>
      new Promise<VoiceRecordResult>((resolve, reject) => {
        if (recorder.state === "inactive") {
          reject(new Error("录音已结束"));
          return;
        }
        finished = { resolve, reject };
        try {
          recorder.requestData?.();
        } catch {
          /* ignore */
        }
        recorder.stop();
      }),
    cancel: () => {
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {
        /* ignore */
      }
      stream.getTracks().forEach((t) => t.stop());
      stopMeter();
      finished = null;
    },
    pause: () => {
      if (recorder.state !== "recording") return;
      recorder.pause();
      pausedAt = Date.now();
    },
    resume: () => {
      if (recorder.state !== "paused") return;
      if (pausedAt != null) pausedMs += Date.now() - pausedAt;
      pausedAt = null;
      recorder.resume();
    },
    durationSec: () => voiceDurationSeconds(elapsedMs()),
    level: () => {
      if (!analyser || !levelSamples || recorder.state !== "recording") return 0;
      analyser.getByteTimeDomainData(levelSamples);
      return voiceSignalLevel(levelSamples);
    },
  };
}
