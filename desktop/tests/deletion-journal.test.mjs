import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeletionJournal } from "../baileys-bridge/deletionJournal.mjs";
import { createBaileysRequestHandler } from "../baileys-bridge/httpServer.mjs";

test("sync replays persisted deletions after event overflow and restart", async () => {
  const prefix = join(tmpdir(), "wap-deletion-journal-");
  const directory = await mkdtemp(prefix);
  try {
    const event = { type: "messages.delete", ts: 1, deviceId: "wa-a", payload: { items: [{ id: "old" }], deletedBefore: "2026-10-01T00:00:00.000Z" } };
    const journal = createDeletionJournal(directory);
    journal.record(event);
    const restarted = createDeletionJournal(directory);
    const deps = { token: "test", port: 1, accountId: "wa-a", events: [], eventsDroppedThrough: 2000, sequence: 2001, snapshot: () => ({ contacts: [], messages: [] }), statusPayload: () => ({ protocolVersion: 4 }), deletionEvents: restarted.snapshot() };
    let body;
    const response = { setHeader() {}, writeHead() {}, end(text) { body = JSON.parse(text); } };
    const handler = createBaileysRequestHandler(() => deps);
    await handler({ method: "GET", url: "/events?after=0", headers: { "x-wap-token": "test" } }, response);
    assert.equal(body.gap.count, 2000);
    await handler({ method: "POST", url: "/sync", headers: { "x-wap-token": "test" } }, response);
    assert.deepEqual(body.deletionEvents, [event]);
  } finally {
    assert.ok(directory.startsWith(prefix));
    await rm(directory, { recursive: true, force: true });
  }
});

const deletion = (ts, ids) => ({ type: "messages.delete", ts, deviceId: "wa-a", payload: { items: ids.map(id => ({ id })), deletedBefore: new Date(ts).toISOString() } });
const encode = events => events.map(event => JSON.stringify(event) + "\n").join("");

test("startup compaction keeps partial batches, independent deletions and write order despite clock rollback", async () => {
  const prefix = join(tmpdir(), "wap-deletion-compaction-");
  const directory = await mkdtemp(prefix);
  try {
    const path = join(directory, "sync-deletions.jsonl");
    const chat = { type: "chats.delete", ts: 1, deviceId: "wa-a", payload: { jids: ["chat@s.whatsapp.net"] } };
    const clear = { type: "messages.delete", ts: 2, deviceId: "wa-a", payload: { all: true, jid: "clear@s.whatsapp.net", deletedBefore: new Date(2).toISOString() } };
    const batch = deletion(2000, ["x", "y"]);
    const newerWrite = deletion(1999, ["x"]);
    const tiedFirst = deletion(3000, ["first"]);
    const tiedSecond = deletion(3000, ["second"]);
    const repeats = Array.from({ length: 1000 }, (_, i) => deletion(i + 3, ["repeated"]));
    const events = [chat, clear, ...repeats, batch, newerWrite, tiedFirst, tiedSecond];
    await writeFile(path, encode(events));
    const expected = [chat, clear, repeats.at(-1), newerWrite, batch, tiedFirst, tiedSecond];
    assert.deepEqual(createDeletionJournal(directory).snapshot(), expected);
    const compressed = await readFile(path, "utf8");
    assert.equal(compressed.trim().split("\n").length, expected.length);
    assert.ok(Buffer.byteLength(compressed) < Buffer.byteLength(encode(events)) / 10);
    assert.deepEqual(createDeletionJournal(directory).snapshot(), expected);
    assert.deepEqual(await readdir(directory), ["sync-deletions.jsonl"]);
    const corrupt = encode(events) + "{incomplete";
    await writeFile(path, corrupt);
    assert.throws(() => createDeletionJournal(directory), SyntaxError);
    assert.equal(await readFile(path, "utf8"), corrupt);
  } finally {
    assert.ok(directory.startsWith(prefix));
    await rm(directory, { recursive: true, force: true });
  }
});

test("new durable records trigger compaction and unique deletion records are retained", async () => {
  const prefix = join(tmpdir(), "wap-deletion-compaction-");
  const directory = await mkdtemp(prefix);
  try {
    const path = join(directory, "sync-deletions.jsonl");
    await writeFile(path, encode(Array.from({ length: 999 }, (_, i) => deletion(i, ["same"]))));
    const journal = createDeletionJournal(directory);
    const latest = deletion(1000, ["same"]);
    journal.record(latest);
    assert.equal((await readFile(path, "utf8")).trim().split("\n").length, 1);
    assert.deepEqual(createDeletionJournal(directory).snapshot(), [latest]);
    const independent = Array.from({ length: 1000 }, (_, i) => deletion(i, [String(i)]));
    const contents = encode(independent);
    await writeFile(path, contents);
    assert.deepEqual(createDeletionJournal(directory).snapshot(), independent);
    assert.equal(await readFile(path, "utf8"), contents);
  } finally {
    assert.ok(directory.startsWith(prefix));
    await rm(directory, { recursive: true, force: true });
  }
});

test("partial temporary writes and failed replacement leave the old journal usable and clean up temporary files", async () => {
  const prefix = join(tmpdir(), "wap-deletion-compaction-");
  const directory = await mkdtemp(prefix);
  const originalWrite = fs.writeFileSync;
  const originalRename = fs.renameSync;
  const originalAppend = fs.appendFileSync;
  try {
    const path = join(directory, "sync-deletions.jsonl");
    const events = Array.from({ length: 1000 }, (_, i) => deletion(i, ["same"]));
    const contents = encode(events);
    for (const stage of ["write", "rename"]) {
      await writeFile(path, contents);
      fs.writeFileSync = stage === "write" ? (target) => {
        originalWrite(target, "partial", { flag: "wx" });
        throw new Error("simulated full disk");
      } : originalWrite;
      fs.renameSync = stage === "rename" ? () => { throw new Error("simulated file lock"); } : originalRename;
      syncBuiltinESMExports();
      const journal = createDeletionJournal(directory);
      assert.deepEqual(journal.snapshot(), [events.at(-1)]);
      assert.equal(await readFile(path, "utf8"), contents);
      assert.deepEqual(await readdir(directory), ["sync-deletions.jsonl"]);
      fs.writeFileSync = originalWrite;
      fs.renameSync = originalRename;
      syncBuiltinESMExports();
      const latest = deletion(1001, ["after-failure"]);
      journal.record(latest);
      assert.deepEqual(journal.snapshot(), [events.at(-1), latest]);
      assert.deepEqual(createDeletionJournal(directory).snapshot(), journal.snapshot());
    }
    const pending = Array.from({ length: 999 }, (_, i) => deletion(i, ["same"]));
    await writeFile(path, encode(pending));
    const journal = createDeletionJournal(directory);
    fs.appendFileSync = () => { throw new Error("simulated append failure"); };
    syncBuiltinESMExports();
    assert.throws(() => journal.record(deletion(1000, ["not-persisted"])), /append failure/);
    fs.appendFileSync = originalAppend;
    syncBuiltinESMExports();
    const durable = deletion(1001, ["persisted"]);
    journal.record(durable);
    assert.throws(() => journal.snapshot(), /删除记录保存失败/);
    assert.deepEqual(createDeletionJournal(directory).snapshot(), [pending.at(-1), durable]);
  } finally {
    fs.writeFileSync = originalWrite;
    fs.renameSync = originalRename;
    fs.appendFileSync = originalAppend;
    syncBuiltinESMExports();
    assert.ok(directory.startsWith(prefix));
    await rm(directory, { recursive: true, force: true });
  }
});
