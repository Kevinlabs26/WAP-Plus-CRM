/**
 * 本地 Mock Android Bridge — 无需手机即可测桌面 TCP 链路
 * 用法: node tools/mock-bridge.mjs
 */
import net from "node:net";

const PORT = Number(process.env.BRIDGE_PORT || 17890);
const TOKEN = process.env.BRIDGE_TOKEN || "dev-bridge-token";

const server = net.createServer((socket) => {
  const peer = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`[+] client ${peer}`);

  const hello = JSON.stringify({
    id: "hello",
    type: "device.hello",
    ts: Date.now(),
    payload: {
      name: "MockPhone",
      model: "Mock Pixel",
      androidVersion: "14",
      bridgeVersion: "0.1.0-mock",
    },
  });

  let buf = "";
  let authenticated = false;
  socket.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      console.log(`[<<] ${line}`);
      try {
        const msg = JSON.parse(line);
        if (msg.type === "wa.open_and_send") {
          console.log(
            `    → MOCK open ${msg.payload?.phoneE164} + send: ${msg.payload?.text}`
          );
        }
        if (msg.type === "wa.type_text") {
          console.log(`    → MOCK type: ${msg.payload?.text}`);
        }
        if (msg.type === "wa.send") {
          console.log(`    → MOCK click send`);
        }
        if (!authenticated) {
          if (
            msg.type !== "bridge.auth" ||
            msg.payload?.token !== TOKEN
          ) {
            socket.write(JSON.stringify({
              id: `error-${msg.id || Date.now()}`,
              type: "error",
              ts: Date.now(),
              payload: {
                refId: msg.id,
                code: "auth_failed",
                message: "Bridge Token 无效",
              },
            }) + "\n");
            socket.destroy();
            return;
          }
          authenticated = true;
          const authAck = JSON.stringify({
            id: `ack-${msg.id || Date.now()}`,
            type: "ack",
            ts: Date.now(),
            payload: {
              refId: msg.id,
              ok: true,
              status: "authenticated",
            },
          });
          socket.write(authAck + "\n" + hello + "\n");
          console.log(`[>>] ${authAck}`);
          continue;
        }
        const ack = JSON.stringify({
          id: `ack-${msg.id || Date.now()}`,
          type: "ack",
          ts: Date.now(),
          payload: { refId: msg.id, ok: true, echoType: msg.type },
        });
        socket.write(ack + "\n");
        console.log(`[>>] ${ack}`);
      } catch (e) {
        console.error("bad json", e);
      }
    }
  });

  socket.on("close", () => console.log(`[-] client ${peer}`));
  socket.on("error", (e) => console.error("socket error", e.message));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Mock Bridge listening on 127.0.0.1:${PORT}`);
  console.log("Desktop: bridge_connect host=127.0.0.1 port=" + PORT + " token=" + TOKEN);
});
