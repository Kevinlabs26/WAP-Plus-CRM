import test from "node:test";
import assert from "node:assert/strict";
import { attachMessageLifecycleEvents } from "../baileys-bridge/messageLifecycleEvents.mjs";

test("reaction event identity comes from reaction.key, not the target message", () => {
  const handlers = new Map();
  const pushed = [];
  const sock = {
    ev: {
      on(name, handler) {
        handlers.set(name, handler);
      },
      off() {},
    },
  };
  attachMessageLifecycleEvents(sock, {
    push(type, payload) {
      pushed.push({ type, payload });
    },
  });

  handlers.get("messages.reaction")([
    {
      key: { id: "target", remoteJid: "chat@s.whatsapp.net", fromMe: false },
      reaction: {
        text: "👍",
        key: { id: "reaction", remoteJid: "chat@s.whatsapp.net", fromMe: true },
      },
    },
  ]);

  assert.equal(pushed[0].type, "messages.sync");
  assert.equal(pushed[0].payload.items[0].fromMe, true);
});
