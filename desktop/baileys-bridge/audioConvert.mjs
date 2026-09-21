import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FFMPEG_AUDIO_TIMEOUT_MS = 60_000;
const FFMPEG_GIF_TIMEOUT_MS = 30_000;
export const MAX_WHATSAPP_AUDIO_SECONDS = 600;

export function parseDataUrl(dataUrl) {
  const m = String(dataUrl || "").match(
    /^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$/
  );
  if (!m) return null;
  return {
    mime: (m[1] || "application/octet-stream").split(";")[0],
    buf: Buffer.from(m[2], "base64"),
  };
}

function runFfmpeg(
  args,
  { timeoutMs, notFoundMessage, label, captureStdout = false },
) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, {
      windowsHide: true,
      stdio: ["ignore", captureStdout ? "pipe" : "ignore", "pipe"],
    });
    let err = "";
    const stdout = [];
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // ponytail: one bounded child process; use a supervisor when conversion becomes a job queue.
      child.kill("SIGKILL");
    }, timeoutMs);
    timer.unref?.();
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    child.stderr?.on("data", (c) => {
      err += c.toString();
      if (err.length > 4000) err = err.slice(-4000);
    });
    child.stdout?.on("data", (c) => stdout.push(c));
    child.on("error", (e) => {
      fail(new Error(e.code === "ENOENT" ? notFoundMessage : `ffmpeg 启动失败：${e.message}`));
    });
    child.on("close", (code) => {
      if (timedOut) {
        fail(new Error(`${label}超时（${Math.round(timeoutMs / 1000)} 秒），已终止 ffmpeg`));
      } else if (code === 0) {
        if (captureStdout) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(Buffer.concat(stdout));
        } else {
          succeed();
        }
      } else {
        fail(new Error(`${label}失败 (code ${code})：${err.slice(-300) || "unknown"}`));
      }
    });
  });
}

export function runFfmpegToOggOpus(inputPath, outputPath, maxSeconds) {
  const args = [
      "-y",
      "-i",
      inputPath,
      "-vn",
      "-map",
      "0:a:0",
      "-ac",
      "1",
      "-ar",
      "48000",
      "-avoid_negative_ts",
      "make_zero",
      "-c:a",
      "libopus",
      "-b:a",
      "64k",
      "-vbr",
      "on",
      "-application",
      "voip",
    ];
  if (Number.isFinite(maxSeconds) && maxSeconds > 0) {
    args.push("-t", String(maxSeconds));
  }
  args.push("-f", "ogg", outputPath);
  return runFfmpeg(
    args,
    {
      timeoutMs: FFMPEG_AUDIO_TIMEOUT_MS,
      notFoundMessage:
        "本机未找到 ffmpeg，无法把录音转成语音条。请安装 ffmpeg 并加入 PATH，或使用支持 Opus 的浏览器录音。",
      label: "ffmpeg 转码",
    },
  );
}

async function buildWaveform(audioPath) {
  const pcm = await runFfmpeg(
    [
      "-v",
      "error",
      "-i",
      audioPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "8000",
      "-f",
      "s16le",
      "pipe:1",
    ],
    {
      timeoutMs: FFMPEG_AUDIO_TIMEOUT_MS,
      notFoundMessage: "本机未找到 ffmpeg，无法生成语音波形。",
      label: "语音波形生成",
      captureStdout: true,
    },
  );
  if (pcm.length < 2) return undefined;

  const bins = new Uint8Array(64);
  let peak = 0;
  for (let i = 0; i < bins.length; i++) {
    const start = Math.floor((pcm.length / 2) * i / bins.length);
    const end = Math.max(start + 1, Math.floor((pcm.length / 2) * (i + 1) / bins.length));
    let sum = 0;
    let count = 0;
    for (let sample = start; sample < end; sample++) {
      const offset = sample * 2;
      const value = Math.abs(pcm.readInt16LE(offset));
      sum += value;
      count++;
    }
    const average = count ? sum / count : 0;
    bins[i] = Math.min(255, Math.round(average));
    peak = Math.max(peak, bins[i]);
  }
  if (!peak) return bins;
  return new Uint8Array(bins.map((value) => Math.min(99, Math.round(value * 99 / peak))));
}

/**
 * 将浏览器录音（webm/ogg/wav/mp4…）转为 WhatsApp PTT 常用的 OGG/Opus。
 * 不直接相信扩展名或 MIME：即使是 OGG，也可能是 Vorbis 等非 Opus 编码。
 * 统一重编码，确保 WhatsApp 官方客户端能识别为语音消息。
 */
export async function ensureOggOpusPtt(
  audioDataUrl,
  mimetypeHint = "",
  maxSeconds,
) {
  const parsed = parseDataUrl(audioDataUrl);
  if (!parsed?.buf?.length) throw new Error("音频 dataUrl 无效");
  if (parsed.buf.length > 14_000_000) throw new Error("语音过长或过大");

  const mime = (parsed.mime || mimetypeHint || "").toLowerCase();
  const dir = await mkdtemp(join(tmpdir(), "wap-ptt-"));
  const ext =
    mime.includes("webm")
      ? "webm"
      : mime.includes("wav")
        ? "wav"
        : mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")
          ? "m4a"
          : mime.includes("mpeg") || mime.includes("mp3")
            ? "mp3"
            : "bin";
  const inPath = join(dir, `in.${ext}`);
  const outPath = join(dir, "out.ogg");
  try {
    await writeFile(inPath, parsed.buf);
    await runFfmpegToOggOpus(inPath, outPath, maxSeconds);
    const out = await readFile(outPath);
    if (!out.length) throw new Error("转码结果为空");
    const waveform = await buildWaveform(outPath).catch(() => undefined);
    return { buf: out, mimetype: "audio/ogg; codecs=opus", waveform };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function ensureGifMp4(gifDataUrl) {
  const parsed = parseDataUrl(gifDataUrl);
  if (!parsed?.buf?.length || parsed.mime !== "image/gif") {
    throw new Error("GIF 数据无效");
  }
  if (parsed.buf.length > 8_000_000) throw new Error("GIF 过大（限约 8MB）");
  const dir = await mkdtemp(join(tmpdir(), "wap-gif-"));
  const inPath = join(dir, "in.gif");
  const outPath = join(dir, "out.mp4");
  try {
    await writeFile(inPath, parsed.buf);
    await runFfmpeg(
      [
        "-y", "-i", inPath, "-t", "15",
        "-vf", "scale=480:480:force_original_aspect_ratio=decrease:force_divisible_by=2",
        "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", outPath,
      ],
      {
        timeoutMs: FFMPEG_GIF_TIMEOUT_MS,
        notFoundMessage: "未找到 ffmpeg，无法转换 GIF",
        label: "GIF 转换",
      },
    );
    const buf = await readFile(outPath);
    if (!buf.length) throw new Error("GIF 转换结果为空");
    return { buf, mimetype: "video/mp4" };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
