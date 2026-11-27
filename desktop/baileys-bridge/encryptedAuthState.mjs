import {
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { join } from "node:path";
import { BufferJSON, initAuthCreds, proto } from "baileys";

export const AUTH_FILE_MAGIC = Buffer.from("WAP-AUTH-1\0");
const AUTH_KEY_INFO = Buffer.from("wap-baileys-auth-v1");
const AUTH_KEY_SALT = Buffer.from("BridgeCRM-Baileys-Auth-Salt");
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function deriveAuthKey(masterKey) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) {
    throw new Error("Baileys auth encryption requires a 32-byte master key");
  }
  return Buffer.from(
    hkdfSync("sha256", masterKey, AUTH_KEY_SALT, AUTH_KEY_INFO, 32)
  );
}

function sanitizeAuthFileName(rawName) {
  return String(rawName || "").replace(/\//g, "__").replace(/:/g, "-");
}

function isEncryptedPayload(rawBytes) {
  return (
    rawBytes.length >= AUTH_FILE_MAGIC.length + IV_LENGTH + TAG_LENGTH &&
    rawBytes.subarray(0, AUTH_FILE_MAGIC.length).equals(AUTH_FILE_MAGIC)
  );
}

function encryptAuthPayload(fileName, utf8Text, authKey) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", authKey, iv);
  cipher.setAAD(Buffer.from(fileName, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(utf8Text, "utf8")),
    cipher.final(),
  ]);
  return Buffer.concat([AUTH_FILE_MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}

function decryptAuthPayload(fileName, rawBytes, authKey) {
  if (!isEncryptedPayload(rawBytes)) {
    return { text: rawBytes.toString("utf8"), wasPlaintext: true };
  }
  const ivStart = AUTH_FILE_MAGIC.length;
  const tagStart = ivStart + IV_LENGTH;
  const bodyStart = tagStart + TAG_LENGTH;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    authKey,
    rawBytes.subarray(ivStart, tagStart)
  );
  decipher.setAAD(Buffer.from(fileName, "utf8"));
  decipher.setAuthTag(rawBytes.subarray(tagStart, bodyStart));
  const plaintext = Buffer.concat([
    decipher.update(rawBytes.subarray(bodyStart)),
    decipher.final(),
  ]);
  return { text: plaintext.toString("utf8"), wasPlaintext: false };
}

async function writeFileAtomically(filePath, payloadBuffer) {
  const tempPath = `${filePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  const handle = await open(tempPath, "w", 0o600);
  try {
    await handle.writeFile(payloadBuffer);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tempPath, filePath);
}

function createPerFileSerializer() {
  const tails = new Map();
  return function runSerialized(fileName, operation) {
    const previous = tails.get(fileName) || Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    tails.set(fileName, next);
    next.finally(() => {
      if (tails.get(fileName) === next) tails.delete(fileName);
    });
    return next;
  };
}

/** Migrate existing plaintext JSON auth files in authDir to AES-256-GCM in place. */
export async function migratePlaintextAuthFiles(authDir, masterKey) {
  const authKey = deriveAuthKey(masterKey);
  let entries = [];
  try {
    entries = await readdir(authDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return { migrated: 0 };
    throw error;
  }

  let migrated = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const filePath = join(authDir, entry.name);
    const rawBytes = await readFile(filePath);
    if (isEncryptedPayload(rawBytes)) continue;
    const utf8Text = rawBytes.toString("utf8");
    // Validate JSON before encrypting so non-JSON files are never corrupted.
    JSON.parse(utf8Text);
    const sealed = encryptAuthPayload(entry.name, utf8Text, authKey);
    await writeFileAtomically(filePath, sealed);
    migrated += 1;
  }
  return { migrated };
}

/** Rollback helper that decrypts encrypted auth JSON files back to plaintext JSON. */
export async function decryptAuthDirectoryToPlaintext(authDir, masterKey) {
  const authKey = deriveAuthKey(masterKey);
  const entries = await readdir(authDir, { withFileTypes: true });
  let restored = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const filePath = join(authDir, entry.name);
    const rawBytes = await readFile(filePath);
    if (!isEncryptedPayload(rawBytes)) continue;
    const { text } = decryptAuthPayload(entry.name, rawBytes, authKey);
    JSON.parse(text);
    await writeFileAtomically(filePath, Buffer.from(text, "utf8"));
    restored += 1;
  }
  return { restored };
}

/**
 * Drop-in replacement for Baileys useMultiFileAuthState with AES-256-GCM at-rest encryption.
 * Reads legacy plaintext JSON transparently and migrates existing auth files on startup.
 */
export async function useEncryptedMultiFileAuthState(authDir, masterKey) {
  const authKey = deriveAuthKey(masterKey);
  await mkdir(authDir, { recursive: true, mode: 0o700 });
  await migratePlaintextAuthFiles(authDir, masterKey);
  const runSerialized = createPerFileSerializer();

  const writeAuthJson = (fileName, value) => {
    const safeName = sanitizeAuthFileName(fileName);
    const filePath = join(authDir, safeName);
    const jsonText = JSON.stringify(value, BufferJSON.replacer);
    const sealed = encryptAuthPayload(safeName, jsonText, authKey);
    return runSerialized(safeName, () => writeFileAtomically(filePath, sealed));
  };

  const readAuthJson = async (fileName) => {
    const safeName = sanitizeAuthFileName(fileName);
    const filePath = join(authDir, safeName);
    try {
      const rawBytes = await readFile(filePath);
      const { text } = decryptAuthPayload(safeName, rawBytes, authKey);
      return JSON.parse(text, BufferJSON.reviver);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  };

  const removeAuthJson = (fileName) => {
    const safeName = sanitizeAuthFileName(fileName);
    const filePath = join(authDir, safeName);
    return runSerialized(safeName, async () => {
      try {
        await unlink(filePath);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    });
  };

  const creds = (await readAuthJson("creds.json")) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const loaded = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readAuthJson(`${type}-${id}.json`);
              if (type === "app-state-sync-key" && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              loaded[id] = value;
            })
          );
          return loaded;
        },
        set: async (keyCategories) => {
          const tasks = [];
          for (const category of Object.keys(keyCategories)) {
            const entries = keyCategories[category];
            if (!entries) continue;
            for (const id of Object.keys(entries)) {
              const value = entries[id];
              const fileName = `${category}-${id}.json`;
              tasks.push(value ? writeAuthJson(fileName, value) : removeAuthJson(fileName));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => writeAuthJson("creds.json", creds),
  };
}
