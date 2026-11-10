import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { detachMessageBuffers } from "./messageStore.mjs";
import { encodeRawMessage, decodeRawMessage, decodeLegacyRawMessage } from "./rawMessageCodec.mjs";

const MAX_ENTRY_BYTES = 4 * 1024 * 1024;

/** Persist only the protocol object needed to download media after a sidecar restart. */
export function createRawMediaStore(
  dir,
  maxEntries = 4000,
  maxBytes = 512 * 1024 * 1024
) {
  let ready;
  let writing;
  const pending = new Map();
  let pendingBytes = 0;
  const pendingLimit = Math.min(maxBytes, 16 * 1024 * 1024);
  const files = new Map();
  let totalBytes = 0;

  // Also trim caches left by older builds on first access.
  const ensureDir = () => (ready ||= mkdir(dir, { recursive: true }).then(scan));
  const fileFor = (id) =>
    join(dir, `${createHash("sha256").update(String(id)).digest("hex")}.bin`);

  async function scan() {
    const names = await readdir(dir);
    const rows = [];
    // Old installs can contain hundreds of thousands of files; bound disk concurrency.
    for (let start = 0; start < names.length; start += 32) {
      const batch = await Promise.all(names.slice(start, start + 32).map(async (name) => {
        try {
          if (name.endsWith(".tmp")) { await unlink(join(dir, name)); return null; }
          if (!name.endsWith(".bin")) return null;
          const info = await stat(join(dir, name));
          return { name, mtime: info.mtimeMs, size: info.size };
        } catch {
          return null;
        }
      }));
      for (const row of batch) if (row) rows.push(row);
    }
    rows.sort((a, b) => a.mtime - b.mtime);
    for (const row of rows) { files.set(row.name, row); totalBytes += row.size; }
    await prune();
  }

  async function prune() {
    for (const [name, file] of files) {
      if (files.size <= maxEntries && totalBytes <= maxBytes) break;
      try {
        await unlink(join(dir, name));
        files.delete(name);
        totalBytes -= file.size;
      } catch {
        /* try again on the next prune if Windows has the file open */
      }
    }
  }

  function save(id, message) {
    if (!id || !message) return Promise.resolve();
    let data;
    try { data = encodeRawMessage(message); } catch { return Promise.resolve(); }
    if (data.byteLength > Math.min(MAX_ENTRY_BYTES, pendingLimit)) return Promise.resolve();
    if (pending.has(id)) { pendingBytes -= pending.get(id).byteLength; pending.delete(id); }
    pending.set(id, data);
    pendingBytes += data.byteLength;
    // Best-effort protocol cache: retain recent downloads, never an unbounded promise chain.
    while (pending.size > maxEntries || pendingBytes > pendingLimit) {
      const oldest = pending.keys().next().value;
      pendingBytes -= pending.get(oldest).byteLength;
      pending.delete(oldest);
    }
    return startWriting();
  }

  function startWriting() {
    writing ||= (async () => {
        await ensureDir();
        while (pending.size) {
          const [nextId, nextData] = pending.entries().next().value;
          pending.delete(nextId);
          pendingBytes -= nextData.byteLength;
          const target = fileFor(nextId);
          const name = basename(target);
          const hash = createHash("sha256").update(nextData).digest("hex");
          if (files.get(name)?.hash === hash) continue;
          const temp = `${target}.${process.pid}.tmp`;
          try {
            await writeFile(temp, nextData);
            await rename(temp, target);
            totalBytes += nextData.byteLength - (files.get(name)?.size || 0);
            files.delete(name);
            files.set(name, { size: nextData.byteLength, hash });
            await prune();
          } catch { await unlink(temp).catch(() => undefined); }
        }
      })().catch(() => { pending.clear(); pendingBytes = 0; })
        .finally(() => { writing = undefined; if (pending.size) return startWriting(); });
    return writing;
  }

  async function load(id) {
    if (!id) return null;
    try {
      await ensureDir();
      const data = await readFile(fileFor(id));
      let decoded;
      try { decoded = decodeRawMessage(data); }
      catch { decoded = await decodeLegacyRawMessage(data); }
      const message = detachMessageBuffers(decoded);
      if (data[0] !== 87) void save(id, message);
      return message;
    } catch {
      return null;
    }
  }

  void ensureDir().catch(() => undefined);
  return { load, save };
}
