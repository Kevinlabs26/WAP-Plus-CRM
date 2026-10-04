import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureOggOpusPtt, ensureGifMp4, safeVideoThumbnail } from '../../../desktop/baileys-bridge/audioConvert.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = path.join(root, '.audit-cache/ffmpeg-candidate');
const candidate = path.join(fixture, 'ffmpeg.exe');
const originalPath = process.env.PATH;
try {
  // Only this test process and its children use the candidate; the system PATH is untouched.
  process.env.PATH = fixture + path.delimiter + originalPath;
  const generate = (args, name) => execFileSync(candidate, ['-hide_banner', '-loglevel', 'error', '-y', ...args, path.join(fixture, name)], { timeout: 30_000 });
  generate(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'pcm_s16le'], 'sample.wav');
  generate(['-f', 'lavfi', '-i', 'color=red:size=32x32:rate=5:duration=1', '-an'], 'sample.gif');
  const audio = await fs.readFile(path.join(fixture, 'sample.wav'));
  const ptt = await ensureOggOpusPtt('data:audio/wav;base64,' + audio.toString('base64'), 'audio/wav', 2);
  assert.equal(ptt.buf.subarray(0, 4).toString(), 'OggS');
  assert.ok(ptt.waveform?.length > 0, 'waveform generation must also succeed');
  const gif = await fs.readFile(path.join(fixture, 'sample.gif'));
  const mp4 = await ensureGifMp4('data:image/gif;base64,' + gif.toString('base64'));
  assert.equal(mp4.buf.subarray(4, 8).toString(), 'ftyp');
  const thumbnail = await safeVideoThumbnail(mp4.buf);
  assert.ok(thumbnail.length > 0);
  await assert.rejects(ensureOggOpusPtt('data:audio/wav;base64,' + Buffer.from('#EXTM3U\nhttps://example.com/private\n').toString('base64')));
  const evidence = { candidate: execFileSync(candidate, ['-version'], { encoding: 'utf8' }).split('\n')[0],
    passed: ['actual WAV-to-Opus export', 'actual waveform export', 'actual GIF-to-MP4 export', 'actual video thumbnail export', 'playlist rejected'],
    opusBytes: ptt.buf.length, waveformBytes: ptt.waveform.length, mp4Bytes: mp4.buf.length, thumbnailBytes: thumbnail.length,
    systemFfmpegChanged: false };
  await fs.writeFile(path.join(root, 'docs/security/ffmpeg-candidate-tests.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  process.env.PATH = originalPath;
}
