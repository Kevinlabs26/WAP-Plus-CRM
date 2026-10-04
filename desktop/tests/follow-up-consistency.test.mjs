import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const built = await build({
  stdin: {
    contents: `export { createFollowUpActions } from './src/store/followUpActions.ts';
      export { getNextOpenFollowUp, bucketFollowUpsForToday, localDayKey } from './src/lib/todayBoard.ts';
      export { calcStats } from './src/store/calcStats.ts';
      export { buildExportBundle, parseBackupJson } from './src/lib/exportData.ts';`,
    resolveDir: fileURLToPath(new URL("../", import.meta.url)),
  },
  bundle: true, write: false, format: "esm", platform: "node",
  alias: { "@": fileURLToPath(new URL("../src/", import.meta.url)) },
});
let tested;
try {
  tested = await import("data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64"));
} catch (error) {
  // Do not print the entire bundled data URL if an import fails.
  throw new Error(`Follow-up test bundle failed to load: ${error?.message || error}`);
}
const { createFollowUpActions, getNextOpenFollowUp, bucketFollowUpsForToday, localDayKey,
  calcStats, buildExportBundle, parseBackupJson } = tested;

const followUp = (id, dueAt, extra = {}) => ({
  id, contactId: "c1", contactName: "甲", dueAt, note: `备注 ${id}`, done: false, ...extra,
});

function setup(followUps = [], contactPatch = {}) {
  let state = {
    contacts: [
      { id: "c1", name: "甲", accountId: "a1", stage: "new", nextFollowUpAt: undefined, ...contactPatch },
      { id: "c2", name: "乙", accountId: "a2", stage: "new", nextFollowUpAt: "2026-09-01" },
    ],
    followUps: structuredClone(followUps),
  };
  const effects = { writes: 0, activities: [], recomputed: 0, persisted: [], toasts: [], clearedNotifications: [] };
  const actions = createFollowUpActions({
    getState: () => state,
    setState: (update) => { effects.writes += 1; state = { ...state, ...update(state) }; },
    logActivity: (contactId, title, detail) => effects.activities.push({ contactId, title, detail }),
    recomputeStats: () => { effects.recomputed += 1; },
    persist: () => effects.persisted.push(structuredClone(state)),
    pushToast: (message, tone) => effects.toasts.push({ message, tone }),
    clearNotification: (id) => effects.clearedNotifications.push(id),
  });
  return {
    actions, effects, get: () => state,
    task: (id) => state.followUps.find((item) => item.id === id),
    contact: (id = "c1") => state.contacts.find((item) => item.id === id),
  };
}

function assertNoWrites(fixture, before) {
  assert.deepEqual(fixture.get(), before);
  assert.equal(fixture.effects.writes, 0);
  assert.equal(fixture.effects.activities.length, 0);
  assert.equal(fixture.effects.recomputed, 0);
  assert.equal(fixture.effects.persisted.length, 0);
  assert.deepEqual(fixture.effects.clearedNotifications, []);
}

test("rescheduling selects the earliest open task, preserves its note and leaves every other task intact", () => {
  const fixture = setup([
    followUp("later", "2026-10-08"),
    followUp("finished", "2026-10-01", { done: true }),
    followUp("current", "2026-10-04T09:00"),
    followUp("other-customer", "2026-09-01", { contactId: "c2", contactName: "乙" }),
    followUp("next", "2026-10-06T11:00"),
  ]);
  const before = structuredClone(fixture.get());
  assert.deepEqual(fixture.actions.scheduleFollowUp("c1", "2026-10-10T10:00"), { dueAt: "2026-10-10T10:00" });
  assert.deepEqual(fixture.task("current"), { ...before.followUps[2], dueAt: "2026-10-10T10:00" });
  assert.deepEqual(fixture.get().followUps.filter((item) => item.id !== "current"),
    before.followUps.filter((item) => item.id !== "current"));
  assert.equal(fixture.contact().nextFollowUpAt, "2026-10-06T11:00");
  assert.deepEqual(fixture.contact("c2"), before.contacts[1]);
  assert.equal(fixture.effects.activities.length, 1);
  assert.equal(fixture.effects.activities[0].contactId, "c1");
  assert.equal(fixture.effects.recomputed, 1);
  assert.equal(fixture.effects.persisted.length, 1);
  assert.equal(fixture.effects.persisted[0].contacts[0].nextFollowUpAt, "2026-10-06T11:00");
});

test("a new explicit note replaces only the selected task note; a blank note preserves it", () => {
  const fixture = setup([followUp("later", "2026-10-08"), followUp("current", "2026-10-04")]);
  fixture.actions.scheduleFollowUp("c1", "2026-10-05", "  发送新报价  ");
  assert.equal(fixture.task("current").note, "发送新报价");
  assert.equal(fixture.task("later").note, "备注 later");
  fixture.actions.scheduleFollowUp("c1", "2026-10-06", "   ");
  assert.equal(fixture.task("current").note, "发送新报价");
  assert.equal(fixture.get().followUps.length, 2);
});

test("opening a legacy date does not create a task; scheduling without an open task creates one and preserves history", () => {
  const fixture = setup([
    followUp("finished", "2026-10-01", { done: true }),
    followUp("cancelled", "2026-10-02", { done: true, cancelled: true }),
  ], { nextFollowUpAt: "2026-10-03" });
  const history = structuredClone(fixture.get().followUps);
  assert.equal(fixture.contact().nextFollowUpAt, "2026-10-03");
  assert.equal(getNextOpenFollowUp(fixture.get().followUps, "c1"), undefined);
  assert.equal(fixture.effects.writes, 0);
  assert.equal(fixture.effects.persisted.length, 0);
  fixture.actions.scheduleFollowUp("c1", "2026-10-07T10:00", "联系客户");
  assert.equal(fixture.get().followUps.length, 3);
  assert.deepEqual(fixture.get().followUps.filter((item) => item.done), history);
  const created = getNextOpenFollowUp(fixture.get().followUps, "c1");
  assert.equal(created.dueAt, "2026-10-07T10:00");
  assert.equal(created.note, "联系客户");
  assert.equal(fixture.contact().nextFollowUpAt, created.dueAt);
});

test("the shared next-task selector filters history and other customers without reordering stored tasks", () => {
  const tasks = [
    followUp("later", "2026-10-08"),
    followUp("done", "2026-09-01", { done: true }),
    followUp("other", "2026-08-01", { contactId: "c2" }),
    followUp("earliest", "2026-10-04T09:00"),
    followUp("cancelled", "2026-09-02", { done: true, cancelled: true }),
  ];
  const before = structuredClone(tasks);
  assert.equal(getNextOpenFollowUp(tasks, "c1").id, "earliest");
  assert.equal(getNextOpenFollowUp(tasks, "missing"), undefined);
  assert.deepEqual(tasks, before);
});

test("completing and reopening a task recalculates the next reminder while preserving other tasks and customers", () => {
  const fixture = setup([
    followUp("later", "2026-10-08"), followUp("current", "2026-10-04"),
    followUp("other", "2026-09-01", { contactId: "c2" }),
  ]);
  const untouchedTask = structuredClone(fixture.task("other"));
  const untouchedContact = structuredClone(fixture.contact("c2"));
  fixture.actions.toggleFollowUp("current");
  assert.equal(fixture.task("current").done, true);
  assert.equal(fixture.contact().nextFollowUpAt, "2026-10-08");
  fixture.actions.toggleFollowUp("later");
  assert.equal(fixture.contact().nextFollowUpAt, undefined);
  fixture.actions.toggleFollowUp("current");
  assert.equal(fixture.task("current").done, false);
  assert.equal(fixture.contact().nextFollowUpAt, "2026-10-04");
  assert.equal(fixture.task("current").note, "备注 current");
  assert.deepEqual(fixture.task("other"), untouchedTask);
  assert.deepEqual(fixture.contact("c2"), untouchedContact);
  assert.equal(fixture.effects.recomputed, 3);
  assert.equal(fixture.effects.persisted.length, 3);
  assert.deepEqual(fixture.effects.clearedNotifications, ["current", "later", "current"]);
});

test("explicit cancellation affects only that ID, retains history and derives the next date from remaining tasks", () => {
  const fixture = setup([
    followUp("later", "2026-10-08"), followUp("current", "2026-10-04"),
    followUp("finished", "2026-10-01", { done: true }),
    followUp("other", "2026-09-01", { contactId: "c2" }),
  ]);
  const before = structuredClone(fixture.get());
  assert.equal(fixture.actions.cancelFollowUp("current"), true);
  assert.deepEqual(fixture.task("current"), { ...before.followUps[1], done: true, cancelled: true });
  assert.deepEqual(fixture.get().followUps.filter((item) => item.id !== "current"),
    before.followUps.filter((item) => item.id !== "current"));
  assert.equal(fixture.contact().nextFollowUpAt, "2026-10-08");
  assert.deepEqual(fixture.contact("c2"), before.contacts[1]);
  assert.equal(fixture.effects.activities.length, 1);
  assert.equal(fixture.effects.activities[0].contactId, "c1");
  assert.equal(fixture.effects.recomputed, 1);
  assert.deepEqual(fixture.effects.persisted[0].followUps, fixture.get().followUps);
  assert.equal(fixture.actions.cancelFollowUp("later"), true);
  assert.equal(fixture.contact().nextFollowUpAt, undefined);
  assert.deepEqual(fixture.effects.clearedNotifications, ["current", "later"]);
});

test("reopening a cancelled task clears cancellation and restores the same task to the pending queue", () => {
  const fixture = setup([
    followUp("current", "2026-10-04", { done: true, cancelled: true }),
    followUp("later", "2026-10-08"),
  ]);
  fixture.actions.toggleFollowUp("current");
  assert.equal(fixture.task("current").done, false);
  assert.equal(Boolean(fixture.task("current").cancelled), false);
  assert.equal(fixture.task("current").note, "备注 current");
  assert.equal(fixture.contact().nextFollowUpAt, "2026-10-04");
  assert.deepEqual(bucketFollowUpsForToday(fixture.get().followUps, "2026-10-04").actionable.map((item) => item.id), ["current"]);
  assert.deepEqual(fixture.effects.clearedNotifications, ["current"]);
});

test("missing IDs and cancellation of completed or cancelled tasks have no state or persistence side effects", () => {
  const fixture = setup([
    followUp("finished", "2026-10-01", { done: true }),
    followUp("cancelled", "2026-10-02", { done: true, cancelled: true }),
  ]);
  const before = structuredClone(fixture.get());
  fixture.actions.toggleFollowUp("missing");
  assert.equal(fixture.actions.cancelFollowUp("missing"), false);
  assert.equal(fixture.actions.cancelFollowUp("finished"), false);
  assert.equal(fixture.actions.cancelFollowUp("cancelled"), false);
  assert.equal(fixture.actions.scheduleFollowUp("missing", "2026-10-04"), null);
  assert.equal(fixture.actions.scheduleFollowUps(["missing"], "2026-10-04"), 0);
  assertNoWrites(fixture, before);
});

test("single and bulk scheduling reject impossible local calendar dates and times before modifying anything", () => {
  const invalid = ["", "not-a-date", "2026-02-29", "2026-04-31", "2026-13-01", "2026-00-05",
    "2026-08-00", "2026-08-32", "2026-10-04T24:00", "2026-10-04T23:60", "2026-10-04T-1:00",
    "2026-10-04T10:00Z", "2026-10-04T10:00:00", "2026-1-04"];
  for (const dueAt of invalid) {
    const fixture = setup([followUp("current", "2026-10-04")]);
    const before = structuredClone(fixture.get());
    assert.equal(fixture.actions.scheduleFollowUp("c1", dueAt, "do not replace"), null, dueAt);
    assert.equal(fixture.actions.scheduleFollowUps(["c1", "c2"], dueAt, "do not replace"), 0, dueAt);
    assertNoWrites(fixture, before);
    assert.equal(fixture.effects.toasts.length, 2, dueAt);
    assert.ok(fixture.effects.toasts.every((toast) => toast.tone === "error"), dueAt);
  }
});

test("valid leap dates, date-only values and local minute values are accepted without conversion to UTC", () => {
  const fixture = setup();
  for (const dueAt of ["2024-02-29", "2026-10-04", "2026-10-04T00:00", "2026-10-04T23:59"]) {
    assert.deepEqual(fixture.actions.scheduleFollowUp("c1", `  ${dueAt}  `), { dueAt });
    assert.equal(fixture.contact().nextFollowUpAt, dueAt);
    assert.equal(getNextOpenFollowUp(fixture.get().followUps, "c1").dueAt, dueAt);
  }
  assert.equal(fixture.effects.toasts.length, 0);
});

test("bulk scheduling retains its all-open-task behavior and notes, creates missing tasks and updates summaries", () => {
  const fixture = setup([
    followUp("later", "2026-10-08"), followUp("earliest", "2026-10-04"),
    followUp("finished", "2026-10-01", { done: true }),
    followUp("c2-history", "2026-09-01", { contactId: "c2", contactName: "乙", done: true, cancelled: true }),
  ]);
  const history = structuredClone(fixture.get().followUps.filter((item) => item.done));
  assert.equal(fixture.actions.scheduleFollowUps(["c1", "c1", "c2", "missing"], "2026-10-10T10:00"), 2);
  for (const id of ["later", "earliest"]) {
    assert.equal(fixture.task(id).dueAt, "2026-10-10T10:00");
    assert.equal(fixture.task(id).note, `备注 ${id}`);
  }
  const c2Task = getNextOpenFollowUp(fixture.get().followUps, "c2");
  assert.equal(c2Task.dueAt, "2026-10-10T10:00");
  assert.deepEqual(fixture.get().followUps.filter((item) => item.done), history);
  for (const contact of fixture.get().contacts) assert.equal(contact.nextFollowUpAt, "2026-10-10T10:00");
  assert.equal(fixture.effects.recomputed, 1);
  assert.equal(fixture.effects.persisted.length, 1);
  fixture.actions.scheduleFollowUps(["c1"], "2026-10-11", "  新批量备注  ");
  for (const id of ["later", "earliest"]) assert.equal(fixture.task(id).note, "新批量备注");
  assert.equal(fixture.task(c2Task.id).dueAt, "2026-10-10T10:00");
  assert.equal(fixture.contact().nextFollowUpAt, "2026-10-11");
  assert.equal(fixture.contact("c2").nextFollowUpAt, "2026-10-10T10:00");
});

test("real task completion, reopening and cancellation reach the same workbench queues and account statistics", () => {
  const today = localDayKey();
  const tomorrowDate = new Date(); tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const yesterdayDate = new Date(); yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const fixture = setup([
    followUp("current", `${today}T09:00`), followUp("later", `${localDayKey(tomorrowDate)}T09:00`),
    followUp("other", `${localDayKey(yesterdayDate)}T09:00`, { contactId: "c2", contactName: "乙" }),
  ]);
  const check = (ids, a1, a2) => {
    const { followUps, contacts } = fixture.get();
    const bucket = bucketFollowUpsForToday(followUps, today);
    const stats = calcStats([], followUps, contacts, []);
    assert.deepEqual(bucket.actionable.map((item) => item.id), ids);
    assert.equal(stats.followUpsToday, ids.length);
    const byAccount = new Map(stats.byAccount.map((item) => [item.accountId, item.followUpsToday]));
    assert.equal(byAccount.get("a1"), a1);
    assert.equal(byAccount.get("a2"), a2);
  };
  check(["other", "current"], 1, 1);
  fixture.actions.toggleFollowUp("current");
  check(["other"], 0, 1);
  fixture.actions.toggleFollowUp("current");
  check(["other", "current"], 1, 1);
  assert.equal(fixture.actions.cancelFollowUp("current"), true);
  check(["other"], 0, 1);
  assert.equal(fixture.contact().nextFollowUpAt, `${localDayKey(tomorrowDate)}T09:00`);
  assert.equal(fixture.get().followUps.length, 3);
});

test("backup export and restore preserve cancellation history without reintroducing cancelled tasks into pending work", () => {
  const fixture = setup([followUp("current", "2026-10-04"), followUp("later", "2026-10-08")]);
  fixture.actions.cancelFollowUp("current");
  const bundle = buildExportBundle({ ...fixture.get(), phones: [], chats: [], messages: [], activities: [],
    broadcastCampaigns: [], settings: {} });
  const restored = parseBackupJson(JSON.parse(JSON.stringify(bundle)));
  const cancelled = restored.followUps.find((item) => item.id === "current");
  assert.equal(cancelled.done, true);
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.note, "备注 current");
  assert.equal(getNextOpenFollowUp(restored.followUps, "c1").id, "later");
  assert.deepEqual(bucketFollowUpsForToday(restored.followUps, "2026-10-10").actionable.map((item) => item.id), ["later"]);
});
