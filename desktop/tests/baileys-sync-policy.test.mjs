import assert from "node:assert/strict";
import { createBaileysRequestHandler } from "../baileys-bridge/httpServer.mjs";

function requestSync(path, deps) {
  let status = 0;
  let body = "";
  const response = {
    setHeader() {},
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

const snapshot = { contacts: [{ id: "saved-contact" }], messages: [{ id: "saved-message" }] };
const backlog = await requestSync("/sync?requestHistory=1", {
  ...deps,
  eventSpool: { health: { blocked: true, warning: "pending local checkpoint" } },
  snapshot: () => snapshot,
  requestFullHistorySync: () => { throw Error("must not request more history while blocked"); },
});
assert.equal(backlog.status, 200);
assert.deepEqual(backlog.body.contacts, snapshot.contacts);
assert.deepEqual(backlog.body.messages, snapshot.messages);
assert.equal(backlog.body.historyRequest.requested, false);
assert.equal(backlog.body.historyRequest.deferred, true);
assert.match(backlog.body.historyRequest.warning, /pending local checkpoint/);

const unavailable = await requestSync("/sync?requestHistory=1", {
  ...deps, eventSpool: { health: { blocked: true, writeError: "disk unavailable", warning: "disk unavailable" } },
});
assert.equal(unavailable.status, 503);
assert.equal(unavailable.body.error, "disk unavailable");
const failedHistory = await requestSync("/sync?requestHistory=1", {
  ...deps, requestFullHistorySync: () => { throw Error("history request failed"); },
});
assert.equal(failedHistory.status, 500);
assert.equal(failedHistory.body.error, "history request failed");

console.log("baileys sync policy: ok");
