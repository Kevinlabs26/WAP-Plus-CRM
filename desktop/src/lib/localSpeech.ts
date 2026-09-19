/**
 * 本地语音识别（sherpa-onnx，经 Rust voice.rs 命令）。
 * - 音频解码用 WebView2 的 WebAudio（支持 ogg/opus/mp4 等全部 WhatsApp 语音格式），
 *   统一重采样为 16k 单声道 PCM i16 后交给 Rust。
 * - 模型文件走 Tauri 原始字节通道上传，解包在 app_data_dir/speech-models/<name>/。
 */
import { invoke } from "@tauri-apps/api/core";

export interface SpeechModelInfo {
  name: string;
  dir: string;
  ready: boolean;
}

/** 可商用的 sherpa-onnx 预置模型（GitHub Releases 直链） */
export const SPEECH_MODEL_PRESETS: {
  id: string;
  label: string;
  detail: string;
  url: string;
}[] = [
  {
    id: "sherpa-onnx-whisper-tiny",
    label: "Whisper Tiny · 多语种",
    detail: "约 170MB · 中/英/法/西/德等 99 种语言，CPU 实时",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.tar.bz2",
  },
  {
    id: "sherpa-onnx-whisper-base",
    label: "Whisper Base · 多语种",
    detail: "约 290MB · 精度更高，速度稍慢",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-base.tar.bz2",
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

/** 下载模型压缩包并交给 Rust 解包。onProgress 回调收到已下载字节数。 */
export async function downloadSpeechModel(
  preset: (typeof SPEECH_MODEL_PRESETS)[number],
  onProgress?: (received: number, total: number) => void,
): Promise<string> {
  const resp = await fetch(preset.url);
  if (!resp.ok) throw new Error(`模型下载失败：HTTP ${resp.status}`);
  const total = Number(resp.headers.get("content-length") || 0);
  let bytes: ArrayBuffer;
  if (resp.body && onProgress) {
    const reader = resp.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      onProgress(received, total);
    }
    bytes = new ArrayBuffer(received);
    const view = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      view.set(chunk, offset);
      offset += chunk.byteLength;
    }
  } else {
    bytes = await resp.arrayBuffer();
    onProgress?.(bytes.byteLength, total || bytes.byteLength);
  }
  return invoke<string>("save_speech_model", bytes, {
    headers: { "x-speech-model-name": preset.id },
  });
}

/** 把任意音频 URL（data:/blob:/http:）解码并重采样成 16k 单声道 PCM i16 */
async function decodeToMono16k(mediaUrl: string): Promise<Int16Array> {
  const resp = await fetch(mediaUrl);
  if (!resp.ok) throw new Error(`无法读取语音文件：HTTP ${resp.status}`);
  const audioBuf = await resp.arrayBuffer();
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
export async function localTranscribe(opts: {
  mediaUrl: string;
  model: string;
  language?: string;
}): Promise<string> {
  const samples = await decodeToMono16k(opts.mediaUrl);
  // JSON 数组对 1 分钟内的语音消息足够小（<4MB），先保简单
  const result = await invoke<{ text: string }>("speech_transcribe", {
    model: opts.model,
    samples: Array.from(samples),
    sampleRate: 16000,
    language: opts.language?.split("-")[0]?.toLowerCase() ?? null,
  });
  return result.text.trim();
}
