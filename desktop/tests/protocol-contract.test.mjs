/**
 * 协议防漂移：shared SSOT ↔ baileys protocol.mjs ↔ Android 源码字符串 ↔ fixtures。
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BAILEYS_BRIDGE_PROTOCOL_VERSION as sharedVersion,
  BAILEYS_LIBRARY_VERSION as sharedLibraryVersion,
} from "../../shared/baileysProtocol.ts";
import {
  MESSAGE_TYPES,
  ANDROID_DISPATCH_MESSAGE_TYPES,
} from "../../shared/protocol.ts";
import {
  BAILEYS_BRIDGE_PROTOCOL_VERSION as runtimeVersion,
  BAILEYS_LIBRARY_VERSION as runtimeLibraryVersion,
} from "../baileys-bridge/protocol.mjs";
import versionsJson from "../../shared/baileys-versions.json" with { type: "json" };

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

assert.equal(sharedVersion, versionsJson.BAILEYS_BRIDGE_PROTOCOL_VERSION);
assert.equal(sharedLibraryVersion, versionsJson.BAILEYS_LIBRARY_VERSION);
assert.equal(runtimeVersion, versionsJson.BAILEYS_BRIDGE_PROTOCOL_VERSION);
assert.equal(runtimeLibraryVersion, versionsJson.BAILEYS_LIBRARY_VERSION);
assert.equal(sharedVersion, runtimeVersion);
assert.equal(sharedLibraryVersion, runtimeLibraryVersion);

const messageTypeSet = new Set(MESSAGE_TYPES);
assert.equal(MESSAGE_TYPES.length, messageTypeSet.size, "MESSAGE_TYPES 含重复");

for (const t of ANDROID_DISPATCH_MESSAGE_TYPES) {
  assert.ok(messageTypeSet.has(t), `ANDROID_DISPATCH 含未知类型: ${t}`);
}

const dispatcherPath = join(
  root,
  "android/app/src/main/java/com/wapplus/bridge/dispatch/MessageDispatcher.kt"
);
const dispatcherSrc = readFileSync(dispatcherPath, "utf8");
const androidBridgeServerSrc = readFileSync(
  join(root, "android/app/src/main/java/com/wapplus/bridge/net/BridgeServer.kt"),
  "utf8"
);
const rustBridgeSrc = readFileSync(join(root, "desktop/src-tauri/src/bridge.rs"), "utf8");
const commandsSrc = readFileSync(join(root, "desktop/src-tauri/src/commands.rs"), "utf8");
for (const t of ANDROID_DISPATCH_MESSAGE_TYPES) {
  assert.match(
    dispatcherSrc,
    new RegExp(`"${t.replace(/\./g, "\\.")}"`),
    `MessageDispatcher.kt 缺少 type 分支: ${t}`
  );
}

const branchTypes = [...dispatcherSrc.matchAll(/^\s*"([^"]+)"\s*->/gm)].map(
  (m) => m[1]
);
assert.ok(branchTypes.length > 0, "无法解析 MessageDispatcher when(type)");
for (const t of branchTypes) {
  assert.ok(
    ANDROID_DISPATCH_MESSAGE_TYPES.includes(t),
    `MessageDispatcher 有未登记 type: ${t}（请更新 shared/protocol.ts ANDROID_DISPATCH_MESSAGE_TYPES）`
  );
}

// Android ACTION_CLICK is not delivery confirmation. Keep the explicit
// clicked status on both send paths and require a delivered status in Rust.
assert.match(dispatcherSrc, /"wa\.send"[\s\S]*?ack\(id, status = "clicked"\)/);
assert.match(dispatcherSrc, /"wa\.open_and_send"[\s\S]*?ack\(id, status = "clicked"\)/);
assert.match(commandsSrc, /pointer\("\/payload\/status"\)[\s\S]*?Some\("delivered"\)/);
assert.match(commandsSrc, /"delivered": delivered/);
assert.match(commandsSrc, /Android 已点击发送，但未收到 WhatsApp 回执/);

// Bridge 认证必须先于 hello，避免未授权客户端读取设备信息或发送命令。
assert.match(androidBridgeServerSrc, /authToken: String/);
assert.match(androidBridgeServerSrc, /auth\?\.optString\("type"\) == "bridge\.auth"/);
assert.match(androidBridgeServerSrc, /MessageDigest\.isEqual/);
assert.match(rustBridgeSrc, /"type": "bridge\.auth"/);
assert.match(commandsSrc, /token: String/);

for (const file of ["commands.rs", "bridge.rs"]) {
  const source = readFileSync(join(root, "desktop/src-tauri/src", file), "utf8");
  for (const match of source.matchAll(/make_envelope\(\s*"([^"]+)"/g)) {
    assert.ok(
      messageTypeSet.has(match[1]),
      `${file} 发出未登记 type: ${match[1]}`
    );
  }
}

const fixtureDir = join(root, "shared/fixtures/android-bridge");
const fixtureFiles = readdirSync(fixtureDir).filter((f) => f.endsWith(".json"));
assert.ok(fixtureFiles.length >= 3, "缺少 android-bridge fixtures");

for (const file of fixtureFiles) {
  const raw = readFileSync(join(fixtureDir, file), "utf8");
  const env = JSON.parse(raw);
  assert.equal(typeof env.id, "string", `${file}: id`);
  assert.equal(typeof env.type, "string", `${file}: type`);
  assert.equal(typeof env.ts, "number", `${file}: ts`);
  assert.ok(env.payload && typeof env.payload === "object", `${file}: payload`);
  assert.ok(messageTypeSet.has(env.type), `${file}: type 不在 MESSAGE_TYPES: ${env.type}`);
}

console.log("protocol-contract.test.mjs ok");
