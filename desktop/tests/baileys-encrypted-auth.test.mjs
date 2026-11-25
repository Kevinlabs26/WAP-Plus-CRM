import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  AUTH_FILE_MAGIC,
  decryptAuthDirectoryToPlaintext,
  useEncryptedMultiFileAuthState,
} from "../baileys-bridge/encryptedAuthState.mjs";

test("useEncryptedMultiFileAuthState encrypts creds and keys at rest and round-trips", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "wap-auth-enc-"));
  const masterKey = randomBytes(32);
  try {
    const first = await useEncryptedMultiFileAuthState(workDir, masterKey);
    first.state.creds.me = { id: "243810000001@s.whatsapp.net", name: "BridgeTester" };
    await first.saveCreds();
    await first.state.keys.set({
      "app-state-sync-key": {
        "key-1": { keyData: new Uint8Array([1, 2, 3, 4]) },
      },
      session: {
        "peer:1/2": { token: Buffer.from("secret-session") },
      },
    });

    const rawCreds = await readFile(join(workDir, "creds.json"));
    assert.ok(rawCreds.subarray(0, AUTH_FILE_MAGIC.length).equals(AUTH_FILE_MAGIC));
    assert.equal(rawCreds.toString("utf8").includes("BridgeTester"), false);

    const reloaded = await useEncryptedMultiFileAuthState(workDir, masterKey);
    assert.equal(reloaded.state.creds.me?.name, "BridgeTester");
    const syncKeys = await reloaded.state.keys.get("app-state-sync-key", ["key-1"]);
    assert.deepEqual(Array.from(syncKeys["key-1"].keyData), [1, 2, 3, 4]);
    const sessions = await reloaded.state.keys.get("session", ["peer:1/2"]);
    assert.equal(Buffer.from(sessions["peer:1/2"].token).toString("utf8"), "secret-session");
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("useEncryptedMultiFileAuthState migrates legacy plaintext files and supports rollback", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "wap-auth-mig-"));
  const masterKey = randomBytes(32);
  try {
    const legacyCreds = {
      registrationId: 12345,
      me: { id: "225070000001@s.whatsapp.net", name: "LegacyUser" },
    };
    await writeFile(join(workDir, "creds.json"), JSON.stringify(legacyCreds), "utf8");

    const loaded = await useEncryptedMultiFileAuthState(workDir, masterKey);
    assert.equal(loaded.state.creds.me?.name, "LegacyUser");

    const migratedBytes = await readFile(join(workDir, "creds.json"));
    assert.ok(migratedBytes.subarray(0, AUTH_FILE_MAGIC.length).equals(AUTH_FILE_MAGIC));
    assert.equal(migratedBytes.toString("utf8").includes("LegacyUser"), false);

    // Wrong key must fail GCM authentication.
    await assert.rejects(() => useEncryptedMultiFileAuthState(workDir, randomBytes(32)));

    // Rollback helper restores valid plaintext JSON.
    const rollback = await decryptAuthDirectoryToPlaintext(workDir, masterKey);
    assert.equal(rollback.restored, 1);
    const plainText = await readFile(join(workDir, "creds.json"), "utf8");
    assert.equal(JSON.parse(plainText).me.name, "LegacyUser");
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});
