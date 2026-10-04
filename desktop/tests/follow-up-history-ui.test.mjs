import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Keep the actual view and click handlers; replace only store, translations,
// and rendering boundaries so this cannot open a real customer or send a message.
const mocks = {
  react: "export const useMemo = fn => fn();",
  "react/jsx-runtime": "export const jsx = (type, props, key) => ({ type, props: props || {}, key }); export const jsxs = jsx;",
  "@/store/appStore": `export const useAppStore = selector => selector(globalThis.followUpUiState);
    useAppStore.getState = () => globalThis.followUpUiState;`,
  "@/i18n": `export const useI18n = () => ({ t: (key, vars = {}) =>
    key + (Object.keys(vars).length ? ':' + JSON.stringify(vars) : '') });`,
  "@/components/ui/primitives": "export const SectionLabel = () => null;",
  "@/components/crm/FollowUpWorkRow": `export const FollowUpWorkRow = () => null;
    export const buildContactWorkCard = f => ({ title: f.contactName });`,
  "@/lib/utils": "export const displayContactLabel = name => name;",
};
const built = await build({
  stdin: {
    contents: "export { FollowUpsView } from './src/components/views/FollowUpsView.tsx';",
    resolveDir: fileURLToPath(new URL("../", import.meta.url)),
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
  plugins: [{ name: "follow-up-ui-boundaries", setup(b) {
    b.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: "mock" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path] }));
  } }],
});
const { FollowUpsView } = await import(
  "data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64")
);

const followUp = (id, patch = {}) => ({
  id, contactId: `contact-${id}`, contactName: `客户 ${id}`,
  dueAt: "2026-01-02", note: "核对报价", done: false, ...patch,
});
function fixture(followUps) {
  const toggled = [], toasts = [];
  const state = {
    followUps, contacts: [], chats: [], settings: { salesStageLabels: {} },
    toggleFollowUp(id) {
      toggled.push(id);
      state.followUps = state.followUps.map(f => f.id === id ? { ...f, done: !f.done, cancelled: undefined } : f);
    },
    updateContact() { throw new Error("unexpected contact update"); },
    openContactWorkspace() { throw new Error("unexpected customer navigation"); },
    pushToast: (...args) => toasts.push(args),
  };
  globalThis.followUpUiState = state;
  return { state, toggled, toasts, render: () => FollowUpsView({}) };
}
function nodes(tree) {
  if (tree == null || typeof tree === "boolean") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (tree == null || typeof tree === "boolean") return "";
  if (Array.isArray(tree)) return tree.map(text).join(" ");
  if (typeof tree !== "object") return String(tree);
  return text(tree.props?.children);
}

test("completed and cancelled history rows show distinct status and preserve the original task identity", () => {
  const run = fixture([
    followUp("completed", { done: true }),
    followUp("cancelled", { done: true, cancelled: true }),
  ]);
  const tree = run.render();
  const completed = nodes(tree).find(n => n.key === "completed");
  const cancelled = nodes(tree).find(n => n.key === "cancelled");
  assert.ok(completed); assert.ok(cancelled);
  assert.match(text(completed), /followUps\.statusCompleted/);
  assert.doesNotMatch(text(completed), /followUps\.statusCancelled/);
  assert.match(text(cancelled), /followUps\.statusCancelled/);
  assert.doesNotMatch(text(cancelled), /followUps\.statusCompleted/);
  assert.match(text(tree), /followUps\.history:\{"count":2\}/);
});

test("cancelled and completed tasks are excluded from actionable rows", () => {
  const run = fixture([
    followUp("pending"),
    followUp("completed", { done: true }),
    followUp("cancelled", { done: true, cancelled: true }),
  ]);
  const actionable = nodes(run.render()).filter(n => n.props.followUp).map(n => n.props.followUp.id);
  assert.deepEqual(actionable, ["pending"]);
});

test("an all-cancelled history does not claim the customer tasks were completed", () => {
  const run = fixture([followUp("cancelled", { done: true, cancelled: true })]);
  const rendered = text(run.render());
  assert.match(rendered, /followUps\.noPending/);
  assert.match(rendered, /followUps\.historyCount:\{"count":1\}/);
  assert.match(rendered, /followUps\.statusCancelled/);
  assert.doesNotMatch(rendered, /followUps\.(?:allDone|completedCount|statusCompleted|done):?/);
});

for (const cancelled of [false, true]) test(`reopening a ${cancelled ? "cancelled" : "completed"} task calls toggle with its ID and returns it to the pending list`, () => {
  const run = fixture([followUp("history-task", { done: true, cancelled })]);
  const row = nodes(run.render()).find(n => n.key === "history-task");
  const reopen = nodes(row).find(n => n.type === "button" && text(n) === "followUps.reopen");
  assert.ok(reopen);
  reopen.props.onClick();
  assert.deepEqual(run.toggled, ["history-task"]);
  assert.deepEqual(run.toasts, [["followUps.reopened:{\"title\":\"客户 history-task\"}", "success"]]);
  assert.equal(run.state.followUps[0].done, false);
  assert.equal(run.state.followUps[0].cancelled, undefined);
  assert.deepEqual(nodes(run.render()).filter(n => n.props.followUp).map(n => n.props.followUp.id), ["history-task"]);
});
