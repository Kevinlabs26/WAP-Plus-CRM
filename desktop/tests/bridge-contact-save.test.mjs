import assert from "node:assert/strict";
import { connectBridge, disconnectBridge, summarizePhoneContactSaveStatuses } from "../src/lib/bridge.ts";

assert.deepEqual(
  summarizePhoneContactSaveStatuses(
    [{ status: "saved" }, { status: "exists" }, { status: "failed" }],
    4
  ),
  { saved: 1, exists: 1, failed: 2 }
);

console.log("bridge contact save summary: ok");

const calls = [];
let finishConnection;
let started;
const startedConnection = new Promise((resolve) => { started = resolve; });
globalThis.window = { __TAURI_INTERNALS__: { invoke(command) {
  calls.push(command);
  if (command === "bridge_connect") {
    started();
    return new Promise((resolve) => { finishConnection = resolve; });
  }
} } };
try {
  const manual = connectBridge("127.0.0.1", 17890, "test-token");
  const automatic = connectBridge("127.0.0.1", 17890, "test-token", true);
  const disconnect = disconnectBridge();
  await startedConnection;
  assert.deepEqual(calls, ["bridge_connect"]);
  finishConnection({ connected: true });
  assert.deepEqual(await manual, await automatic);
  await disconnect;
  assert.deepEqual(calls, ["bridge_connect", "bridge_disconnect"]);
} finally {
  delete globalThis.window;
}
