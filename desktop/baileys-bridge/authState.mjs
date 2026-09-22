import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { proto, initAuthCreds, BufferJSON, makeCacheableSignalKeyStore } from "baileys";

/** Atomic single-file auth state: fewer partial writes than multi-file auth. */
export async function useAtomicAuthState(file, logger) {
  await mkdir(dirname(file), { recursive: true });
  let state;
  try {
    state = JSON.parse(await readFile(file, "utf8"), BufferJSON.reviver);
  } catch {
    state = { creds: initAuthCreds(), keys: {} };
  }
  state.creds ||= initAuthCreds();
  state.keys ||= {};
  let writeQueue = Promise.resolve();

  const persist = () => {
    writeQueue = writeQueue.then(async () => {
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(state, BufferJSON.replacer));
      await rename(tmp, file);
    }).catch((error) => logger?.error?.({ err: error }, "auth state write failed"));
    return writeQueue;
  };

  const keys = {
    get: async (type, ids) => {
      const out = {};
      for (const id of ids) {
        let value = state.keys[`${type}-${id}`];
        if (type === "app-state-sync-key" && value) {
          value = proto.Message.AppStateSyncKeyData.fromObject(value);
        }
        out[id] = value;
      }
      return out;
    },
    set: async (data) => {
      for (const [type, values] of Object.entries(data || {})) {
        for (const [id, value] of Object.entries(values || {})) {
          const key = `${type}-${id}`;
          if (value) state.keys[key] = value;
          else delete state.keys[key];
        }
      }
      await persist();
    },
    clear: async () => {
      state.keys = {};
      await persist();
    },
  };

  return {
    state: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(keys, logger),
    },
    saveCreds: persist,
  };
}
