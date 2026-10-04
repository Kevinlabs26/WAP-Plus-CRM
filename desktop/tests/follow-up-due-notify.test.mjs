import assert from "node:assert/strict";
import test, { beforeEach, afterEach } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Exercise the real notifier with a recording desktop boundary, never the OS.
const built = await build({
  stdin: {
    contents: `export { notifyDueFollowUps, clearFollowUpNotifyDedupe } from './src/lib/followUpDueNotify.ts';`,
    resolveDir: fileURLToPath(new URL("../", import.meta.url)),
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "esm",
  alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
  plugins: [{ name: "record-notifications", setup(b) {
    b.onResolve({ filter: /^@\/lib\/desktopNotify$/ }, args => ({ path: args.path, namespace: "mock" }));
    b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
      contents: `export const showDesktopNotify = options => { globalThis.followUpNotifications.push(options); return Promise.resolve(); };`,
    }));
  } }],
});
const { notifyDueFollowUps, clearFollowUpNotifyDedupe } = await import(
  "data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64")
);

const originalDocument = globalThis.document;
const originalNotifications = globalThis.followUpNotifications;
const now = (hour = 10, minute = 0, day = 4) => new Date(2026, 9, day, hour, minute);
const followUp = (patch = {}) => ({
  id: "followup-customer-a",
  contactId: "customer-a",
  contactName: "验收客户",
  dueAt: "2026-10-04T09:00:00",
  note: "核对报价",
  done: false,
  ...patch,
});
const handlers = { enabled: true, openFollowUp() {} };

beforeEach(() => {
  clearFollowUpNotifyDedupe();
  globalThis.document = { hasFocus: () => false, hidden: false };
  globalThis.followUpNotifications = [];
});
afterEach(() => {
  clearFollowUpNotifyDedupe();
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
  if (originalNotifications === undefined) delete globalThis.followUpNotifications;
  else globalThis.followUpNotifications = originalNotifications;
});

test("unchanged due time is deduplicated across polling and becomes eligible after six hours", () => {
  const item = followUp();
  assert.equal(notifyDueFollowUps([item], handlers, now()), 1);
  assert.equal(notifyDueFollowUps([item], handlers, now(10, 1)), 0);
  assert.equal(notifyDueFollowUps([item], handlers, now(16)), 0);
  assert.equal(notifyDueFollowUps([item], handlers, now(16, 1)), 1);
  assert.equal(globalThis.followUpNotifications.length, 2);
});

test("rescheduling the same ID to later today does not notify early and notifies at the new time", () => {
  const original = followUp();
  assert.equal(notifyDueFollowUps([original], handlers, now()), 1);
  const rescheduled = { ...original, dueAt: "2026-10-04T11:00:00" };
  assert.equal(notifyDueFollowUps([rescheduled], handlers, now(10, 30)), 0);
  assert.equal(notifyDueFollowUps([rescheduled], handlers, now(11)), 1);
  assert.equal(notifyDueFollowUps([rescheduled], handlers, now(11, 1)), 0);
  assert.equal(globalThis.followUpNotifications.length, 2);
  assert.match(globalThis.followUpNotifications[1].body, /2026-10-04 11:00/);
});

test("rescheduling to a future day waits for that day and a new overdue date notifies within the old dedupe window", () => {
  const original = followUp();
  assert.equal(notifyDueFollowUps([original], handlers, now()), 1);
  const future = { ...original, dueAt: "2026-10-05" };
  assert.equal(notifyDueFollowUps([future], handlers, now(11)), 0);
  const overdue = { ...original, dueAt: "2026-10-03" };
  assert.equal(notifyDueFollowUps([overdue], handlers, now(11)), 1);
  assert.match(globalThis.followUpNotifications[1].title, /逾期/);
  assert.equal(notifyDueFollowUps([future], handlers, now(0, 0, 5)), 1);
});

test("a completed follow-up never notifies even if its date changes", () => {
  const original = followUp();
  assert.equal(notifyDueFollowUps([original], handlers, now()), 1);
  assert.equal(notifyDueFollowUps([{ ...original, done: true, dueAt: "2026-10-03" }], handlers, now(11)), 0);
  assert.equal(globalThis.followUpNotifications.length, 1);
});

test("a batch marks each current date and rescheduling one item only notifies that item", () => {
  const first = followUp();
  const second = followUp({ id: "followup-customer-b", contactId: "customer-b", contactName: "另一客户" });
  const opened = [];
  const clickHandlers = { enabled: true, openFollowUp: item => opened.push(item.id) };
  assert.equal(notifyDueFollowUps([first, second], clickHandlers, now()), 2);
  assert.equal(globalThis.followUpNotifications.length, 1);
  assert.equal(notifyDueFollowUps([first, second], clickHandlers, now(10, 1)), 0);
  const rescheduled = { ...second, dueAt: "2026-10-04T10:30:00" };
  assert.equal(notifyDueFollowUps([first, rescheduled], clickHandlers, now(10, 30)), 1);
  assert.equal(globalThis.followUpNotifications.length, 2);
  globalThis.followUpNotifications[1].onClick();
  assert.deepEqual(opened, [second.id]);
});

test("clearing one ID leaves other marks intact and clearing without an ID resets all", () => {
  const first = followUp();
  const second = followUp({ id: "followup-customer-b", contactId: "customer-b" });
  assert.equal(notifyDueFollowUps([first, second], handlers, now()), 2);
  clearFollowUpNotifyDedupe(first.id);
  assert.equal(notifyDueFollowUps([first, second], handlers, now(10, 1)), 1);
  clearFollowUpNotifyDedupe();
  assert.equal(notifyDueFollowUps([first, second], handlers, now(10, 2)), 2);
  assert.equal(globalThis.followUpNotifications.length, 3);
});

test("disabled or focused-today suppression does not consume a due-time mark", () => {
  const item = followUp();
  assert.equal(notifyDueFollowUps([item], { ...handlers, enabled: false }, now()), 0);
  globalThis.document.hasFocus = () => true;
  assert.equal(notifyDueFollowUps([item], { ...handlers, suppressWhenFocusedToday: true, activeNav: "today" }, now()), 0);
  assert.equal(notifyDueFollowUps([item], handlers, now()), 1);
  assert.equal(globalThis.followUpNotifications.length, 1);
});
