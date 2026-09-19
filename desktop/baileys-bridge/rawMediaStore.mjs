import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deserialize, serialize } from "node:v8";

/** Persist only the protocol object needed to download media after a sidecar restart. */
export function createRawMediaStore(dir, maxEntries = 4000) {
  let ready;
  let writeQueue = Promise.resolve();
  let writesSincePrune = maxEntries;

  const ensureDir = () => (ready ||= mkdir(dir, { recursive: true }));
  const fileFor = (id) =>
    join(dir, `${createHash("sha256").update(String(id)).digest("hex")}.bin`);

  async function prune() {
    const names = (await readdir(dir)).filter((name) => name.endsWith(".bin"));
    if (names.length <= maxEntries) return;
    const rows = await Promise.all(
      names.map(async (name) => ({ name, mtime: (await stat(join(dir, name))).mtimeMs }))
    );
    rows.sort((a, b) => a.mtime - b.mtime);
    await Promise.all(
      rows.slice(0, rows.length - maxEntries).map(({ name }) =>
        unlink(join(dir, name)).catch(() => undefined)
      )
    );
  }

  function save(id, message) {
    if (!id || !message) return Promise.resolve();
    writeQueue = writeQueue
      .then(async () => {
        await ensureDir();
        const target = fileFor(id);
        const temp = `${target}.${process.pid}.tmp`;
        await writeFile(temp, serialize(message));
        await rename(temp, target);
        writesSincePrune++;
        if (writesSincePrune >= 200) {
          writesSincePrune = 0;
          await prune();
        }
      })
      .catch(() => undefined);
    return writeQueue;
  }

  async function load(id) {
    if (!id) return null;
    try {
      await ensureDir();
      return deserialize(await readFile(fileFor(id)));
    } catch {
      return null;
    }
  }

  return { load, save };
}
