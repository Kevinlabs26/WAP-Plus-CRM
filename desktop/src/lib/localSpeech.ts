/**
 * 本地语音识别（sherpa-onnx，经 Rust voice.rs 命令）。
 * - 音频解码用 WebView2 的 WebAudio（支持 ogg/opus/mp4 等全部 WhatsApp 语音格式），
 *   统一重采样为 16k 单声道 PCM i16 后交给 Rust。
 * - 模型由 Tauri 后端下载并解包到 app_data_dir/speech-models/<name>/。
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { mediaUrlToBlob } from "@/lib/mediaBlob";
import { abortable } from "./abortable";

export interface SpeechModelInfo {
  name: string;
  dir: string;
  ready: boolean;
}

/** 可商用的 sherpa-onnx 预置模型 */
export const SPEECH_MODEL_PRESETS: {
  id: string;
  label: string;
  detail: string;
}[] = [
  {
    id: "sherpa-onnx-whisper-tiny",
    label: "Whisper Tiny · 多语种",
    detail: "约 170MB · 中/英/法/西/德等 99 种语言，CPU 实时",
  },
  {
    id: "sherpa-onnx-whisper-base",
    label: "Whisper Base · 多语种",
    detail: "约 290MB · 精度更高，速度稍慢",
  },
];

export async function listLocalSpeechModels(): Promise<SpeechModelInfo[]> {
  try {
    return await invoke<SpeechModelInfo[]>("list_speech_models");
  } catch {
    return [];
  }
}

export async function findReadyLocalModel(): Promise<SpeechModelInfo | null> {
  const models = await listLocalSpeechModels();
  return models.find((m) => m.ready) ?? null;
}

export async function removeLocalSpeechModel(name: string): Promise<void> {
  await invoke("remove_speech_model", { name });
}

/** 由桌面后台下载和解包。onProgress 回调收到已下载字节数。 */
export async function downloadSpeechModel(
  preset: (typeof SPEECH_MODEL_PRESETS)[number],
  onProgress?: (received: number, total: number) => void,
): Promise<string> {
  const unlisten = onProgress && await listen<{ model: string; received: number; total: number }>(
    "speech-model-download-progress",
    ({ payload }) => {
      if (payload.model === preset.id) onProgress(payload.received, payload.total);
    },
  ).catch(() => undefined);
  try {
    return await invoke<string>("download_speech_model", { name: preset.id });
  } catch (error) {
    if (typeof error === "string" && error.trim()) throw new Error(error);
    throw error;
  } finally {
    unlisten?.();
  }
}

/** 把任意音频 URL（data:/blob:/http:）解码并重采样成 16k 单声道 PCM i16 */
async function decodeToMono16k(mediaUrl: string, signal?: AbortSignal): Promise<Int16Array> {
  const audioBuf = await (await mediaUrlToBlob(mediaUrl, "audio/webm", signal)).arrayBuffer();
  signal?.throwIfAborted();
  const ctx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(audioBuf);
  } finally {
    void ctx.close().catch(() => undefined);
  }
  const targetRate = 16000;
  const frames = Math.max(1, Math.ceil(decoded.duration * targetRate));
  const offline = new OfflineAudioContext(1, frames, targetRate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  const f32 = rendered.getChannelData(0);
  const samples = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    samples[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return samples;
}

/**
 * 本地转写一条语音。返回 null 表示没有就绪的本地模型（调用方回落云端）；
 * 模型存在但推理失败会抛错，由调用方决定是否回落。
 */
let localJob: { mediaUrl: string; model: string; language?: string; running: boolean; work: Promise<string> } | undefined;

export async function localTranscribe(opts: {
  mediaUrl: string;
  model: string;
  language?: string;
  signal?: AbortSignal;
}): Promise<string> {
  opts.signal?.throwIfAborted();
  while (localJob) {
    if (localJob.mediaUrl === opts.mediaUrl && localJob.model === opts.model && localJob.language === opts.language) return abortable(localJob.work, opts.signal);
    if (!localJob.running) break;
    await abortable(localJob.work.catch(() => ""), opts.signal);
    opts.signal?.throwIfAborted();
  }
  // Native inference cannot be interrupted. Keep one result and serialize the next job.
  const work = (async () => {
    const samples = await decodeToMono16k(opts.mediaUrl, opts.signal);
    opts.signal?.throwIfAborted();
    const result = await invoke<{ text: string }>("speech_transcribe", {
      model: opts.model, samples: Array.from(samples), sampleRate: 16000,
      language: opts.language?.split("-")[0]?.toLowerCase() ?? null,
    });
    return result.text.trim();
  })();
  const job = { mediaUrl: opts.mediaUrl, model: opts.model, language: opts.language, running: true, work };
  localJob = job;
  work.then(() => { job.running = false; }, () => { job.running = false; if (localJob === job) localJob = undefined; });
  return abortable(work, opts.signal);
}
