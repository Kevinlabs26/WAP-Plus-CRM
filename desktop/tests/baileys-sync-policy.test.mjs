import assert from "node:assert/strict";
import { createBaileysRequestHandler } from "../baileys-bridge/httpServer.mjs";

function requestSync(path, deps) {
  let status = 0;
  let body = "";
  const response = {
    writeHead(code) {
      status = code;
    },
    end(value = "") {
      body = String(value);
    },
  };
  return createBaileysRequestHandler(() => deps)(
    { method: "POST", url: path, headers: { "x-wap-token": deps.token } },
    response
  ).then(() => ({ status, body: JSON.parse(body) }));
}

let groupHydrates = 0;
let historyRequests = 0;
const deps = {
  token: "test-token",
  port: 17890,
  accountId: "wa-test",
  socket: {},
  contacts: new Map(),
  snapshot: () => ({ contacts: [], messages: [] }),
  statusPayload: () => ({ protocolVersion: 1, connection: "connected" }),
  hydrateGroupSubjects: async () => {
    groupHydrates += 1;
    return { checked: 0, updated: 0 };
  },
  requestFullHistorySync: async () => {
    historyRequests += 1;
    return { requested: true, requestId: "history-1" };
  },
};

assert.equal((await requestSync("/sync", deps)).status, 200);
assert.equal(groupHydrates, 0);
assert.equal(
  (await requestSync("/sync?hydrateGroups=1", deps)).status,
  200
);
assert.equal(groupHydrates, 1);
const history = await requestSync("/sync?requestHistory=1", deps);
assert.equal(historyRequests, 1);
assert.deepEqual(history.body.historyRequest, {
  requested: true,
  requestId: "history-1",
});

console.log("baileys sync policy: ok");
