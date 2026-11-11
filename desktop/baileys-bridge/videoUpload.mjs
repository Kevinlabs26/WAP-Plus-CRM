import { mkdtemp, open, rm, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const invalid = message => Object.assign(new Error(message), { status: 400 });
const TEMP_PREFIX = 'wap-plus-video-';
let cleanup;

export async function cleanupAbandonedVideos() {
  const root = tmpdir();
  for (const entry of await readdir(root, {withFileTypes:true})) {
    if (!entry.isDirectory() || !entry.name.startsWith(TEMP_PREFIX)) continue;
    const path = join(root, entry.name);
    try {
      if ((await stat(path)).mtimeMs < Date.now() - 86400_000) await rm(path, {recursive:true, force:true});
    } catch { /* A locked folder can be retried on the next bridge start. */ }
  }
}

// A bounded JSON header followed by raw video bytes; never buffer the whole upload.
export async function receiveVideoUpload(request, document = false) {
  await (cleanup ??= cleanupAbandonedVideos().catch(() => {}));
  const label=document ? "文件" : "视频";
  const directory = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
  const path = join(directory, document ? 'upload.bin' : 'upload.mp4');
  let file;
  let pending = Buffer.alloc(0), metadata, bytes = 0;
  let complete = false;
  try {
    file = await open(path, 'wx');
    for await (const raw of request) {
      let chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      if (!metadata) {
        pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
        if (pending.length < 4) continue;
        const length = pending.readUInt32BE(0);
        if (!length || length > 65536) throw invalid(label+'上传信息无效');
        if (pending.length < length + 4) continue;
        try { metadata = JSON.parse(pending.subarray(4, length + 4).toString('utf8')); }
        catch { throw invalid(label+'上传信息无效'); }
        if (!metadata || typeof metadata.phoneE164 !== 'string' || !metadata.phoneE164.trim() || metadata.phoneE164.length > 256 ||
            typeof metadata.caption !== 'string' || metadata.caption.length > 4000 ||
            !Number.isSafeInteger(metadata.size) || metadata.size <= 0) throw invalid(label+'上传信息无效');
        if (document && (typeof metadata.fileName !== 'string' || !metadata.fileName.trim() || metadata.fileName.length > 255 || /[\u0000-\u001f]/.test(metadata.fileName) || typeof metadata.mimetype !== 'string' || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(metadata.mimetype))) throw invalid('文件上传信息无效');
        if (metadata.size > MAX_VIDEO_BYTES) throw Object.assign(new Error(label+'超过 100 MiB'), {status:413});
        chunk = pending.subarray(length + 4);
        pending = Buffer.alloc(0);
      }
      bytes += chunk.length;
      if (bytes > MAX_VIDEO_BYTES || bytes > metadata.size) throw Object.assign(new Error(label+'超过上传大小限制'), {status:413});
      await file.writeFile(chunk);
    }
    if (!metadata || bytes !== metadata.size) throw invalid(label+'上传不完整，请重新选择文件');
    complete = true;
    return {path, metadata, cleanup: () => rm(directory, {recursive:true, force:true})};
  } finally {
    try { await file?.close(); }
    finally { if (!complete) await rm(directory, {recursive:true, force:true}); }
  }
}
