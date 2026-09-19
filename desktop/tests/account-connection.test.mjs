import test from "node:test";
import assert from "node:assert/strict";
import {
  isWaAccountConnected,
  resolveWaAccountConnection,
  resolveWaSendAccountId,
} from "../src/lib/accountConnection.ts";

test("account connection uses the target slot instead of another live account", () => {
  const accounts = [
    { id: "a", status: "disconnected" },
    { id: "b", status: "connected" },
  ];
  assert.equal(isWaAccountConnected(accounts, "b", "a", "close"), true);
  assert.equal(isWaAccountConnected(accounts, "a", "a", "close"), false);
  assert.equal(isWaAccountConnected(accounts, "a", "a", "connected"), true);
  assert.equal(isWaAccountConnected(accounts, "missing", "a", "connected"), false);
  assert.equal(
    isWaAccountConnected(
      [{ id: "a", status: "connected" }],
      "a",
      "a",
      "error"
    ),
    false
  );
});

test("live state overrides only its own stale slot", () => {
  const accounts = [
    { id: "a", status: "connected" },
    { id: "b", status: "connected" },
  ];
  assert.equal(resolveWaAccountConnection(accounts, "a", "a", "error"), "error");
  assert.equal(
    resolveWaAccountConnection(accounts, "b", "a", "error"),
    "connected"
  );
  assert.equal(isWaAccountConnected(accounts, "a", "a", "error"), false);
  assert.equal(isWaAccountConnected(accounts, "b", "a", "error"), true);
});

test("single connected account repairs a legacy requested id", () => {
  assert.equal(
    resolveWaSendAccountId(
      [{ id: "wa-live", status: "connected" }],
      "baileys",
      "wa-live",
      "connected"
    ),
    "wa-live"
  );
  assert.equal(
    resolveWaSendAccountId(
      [
        { id: "wa-a", status: "disconnected" },
        { id: "wa-b", status: "connected" },
      ],
      "wa-a",
      "wa-b",
      "connected"
    ),
    "wa-a"
  );
});
