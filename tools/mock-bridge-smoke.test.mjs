import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { once } from "node:events";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const port = 17891;
const child = spawn(process.execPath, ["tools/mock-bridge.mjs"], {
  cwd: dirname(dirname(fileURLToPath(import.meta.url))),
  env: { ...process.env, BRIDGE_PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});

const cleanup = () => {
  if (!child.killed) child.kill();
};

try {
  const deadline = Date.now() + 5000;
  let socket;
  while (!socket && Date.now() < deadline) {
    socket = await new Promise((resolve) => {
      const candidate = net.createConnection({ host: "127.0.0.1", port });
      candidate.once("connect", () => resolve(candidate));
      candidate.once("error", () => {
        candidate.destroy();
        resolve(null);
      });
    });
    if (!socket) await delay(50);
  }
  if (!socket) throw new Error("mock bridge did not start");

  let buffer = "";
  const nextJson = async () => {
    while (true) {
      const end = buffer.indexOf("\n");
      if (end >= 0) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        if (line) return JSON.parse(line);
      }
      const [chunk] = await once(socket, "data");
      buffer += chunk.toString("utf8");
    }
  };

  socket.write(JSON.stringify({
    id: "smoke-auth",
    type: "bridge.auth",
    ts: Date.now(),
    payload: { token: "dev-bridge-token" },
  }) + "\n");

  const authAck = await nextJson();
  assert.equal(authAck.type, "ack");
  assert.equal(authAck.payload.status, "authenticated");

  const deviceHello = await nextJson();
  assert.equal(deviceHello.type, "device.hello");
  assert.equal(deviceHello.payload.model, "Mock Pixel");

  socket.write(JSON.stringify({
    id: "smoke-1",
    type: "wa.open_and_send",
    ts: Date.now(),
    payload: { phoneE164: "+12025550123", text: "smoke" },
  }) + "\n");

  const ack = await nextJson();
  assert.equal(ack.type, "ack");
  assert.equal(ack.payload.refId, "smoke-1");
  assert.equal(ack.payload.ok, true);

  socket.destroy();
  console.log("mock-bridge-smoke.test.mjs ok");
} finally {
  cleanup();
}
