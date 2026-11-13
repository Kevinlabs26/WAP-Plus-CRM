import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build, transform } from "esbuild";
import { langShortLabel, resolveTargetLang, resolveTargetLanguage, TRANSLATE_LANGS } from "../src/lib/translateDraft.ts";

const settings = { translateTargetLang: "en" };
const inbound = "你好，请问产品的价格是多少？";

test("target language retains existing priority and reports its actual source", () => {
  for (const [contact, body, config, expected] of [
    [{ preferredLang: "es", country: "France" }, inbound, settings, { code: "es", source: "preferred" }],
    [{ preferredLang: "auto", country: "France" }, inbound, settings, { code: "fr", source: "country" }],
    [{ preferredLang: "invalid" }, inbound, settings, { code: "zh", source: "message" }],
    [undefined, "👍", { translateTargetLang: "pt" }, { code: "pt", source: "default" }],
    [undefined, "", { translateTargetLang: "auto" }, { code: "en", source: "default" }],
  ]) {
    assert.deepEqual(resolveTargetLanguage(contact, config, body), expected);
    assert.equal(resolveTargetLang(contact, config, body), expected.code);
  }
});

test("Swahili is a valid translation target", () => {
  assert.deepEqual(TRANSLATE_LANGS.find((language) => language.code === "sw"), {
    code: "sw", label: "Kiswahili", native: "SW",
  });
  assert.equal(langShortLabel("sw"), "SW");
  assert.deepEqual(resolveTargetLanguage(undefined, { translateTargetLang: "sw" }, ""), {
    code: "sw", source: "default",
  });
});

// Run the actual Composer handler; service and draft writes throw if it ever
// tries to translate, send, or replace text while changing a preference.
const composerSource = readFileSync(new URL("../src/components/chat/Composer.tsx", import.meta.url), "utf8");
test("enter translation workflow is opt-in and keeps attachments on the normal send path", () => {
  assert.match(composerSource, /enterTranslateSend/);
  assert.match(composerSource, /pendingMedia\.length === 0/);
  assert.match(composerSource, /translateOriginal == null/);
  assert.match(composerSource, /handleBackTranslate/);
  assert.match(composerSource, /detectMessageLanguage\(original\)/);
  assert.match(composerSource, /void runBackTranslation\(base, next\)/);
});
const start = composerSource.indexOf("  const handleTranslateLangChange =");
const end = composerSource.indexOf("  const handleTranslateDraft =", start);
assert.ok(start >= 0 && end > start);
const handler = await transform(composerSource.slice(start, end), { loader: "ts" });
const create = new Function("resolveTargetLanguage", `return (opts) => {
  let activeContact = opts.contact, translating = false;
  let translationTarget = resolveTargetLanguage(activeContact, opts.settings, opts.inbound);
  const lastInboundBody = opts.inbound, updates = [];
  const draft = '  客户 A 的草稿，原文与译文保持不变  ';
  const translateOriginal = 'original before translation';
  const fullSettings = () => opts.settings;
  const updateContact = (id, patch) => {
    updates.push({ id, patch });
    activeContact = { ...activeContact, ...patch };
  };
  const setTranslationTarget = value => { translationTarget = value; };
  const setDraftLocal = () => { throw new Error('unexpected draft replacement'); };
  const flushDraftNow = () => { throw new Error('unexpected draft flush'); };
  const translateDraftText = () => { throw new Error('unexpected translation request'); };
  const onSend = () => { throw new Error('unexpected send'); };
  ${handler.code}
  return { change: handleTranslateLangChange, updates,
    setBusy(value) { translating = value; },
    switchContact(value) { activeContact = value; },
    state: () => ({ activeContact, translationTarget, draft, translateOriginal }) };
};`)(resolveTargetLanguage);

test("manual choice is remembered and restoring auto clears only that contact preference without requests or draft edits", () => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = () => { networkCalls++; throw new Error("unexpected network request"); };
  try {
    const ui = create({ contact: { id: "account-a/customer", country: "France" }, settings, inbound });
    const before = ui.state();
    ui.change("de");
    assert.equal(ui.state().activeContact.preferredLang, "de");
    assert.deepEqual(ui.state().translationTarget, { code: "de", source: "preferred" });
    ui.change("auto");
    assert.deepEqual(ui.updates, [
      { id: "account-a/customer", patch: { preferredLang: "de" } },
      { id: "account-a/customer", patch: { preferredLang: undefined } },
    ]);
    assert.deepEqual(ui.state().translationTarget, { code: "fr", source: "country" });
    assert.equal(ui.state().draft, before.draft);
    assert.equal(ui.state().translateOriginal, before.translateOriginal);
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("restoring auto selects message or default immediately and cannot change a running translation", () => {
  for (const [body, expected] of [
    [inbound, { code: "zh", source: "message" }],
    ["👍", { code: "en", source: "default" }],
  ]) {
    const ui = create({ contact: { id: "account-b/customer", preferredLang: "es" }, settings, inbound: body });
    const before = ui.state();
    ui.setBusy(true);
    ui.change("auto");
    ui.change("fr");
    assert.deepEqual(ui.state(), before);
    assert.deepEqual(ui.updates, []);
    ui.setBusy(false);
    ui.change("auto");
    assert.deepEqual(ui.state().translationTarget, expected);
  }
  const ui = create({ contact: { id: "account-a/customer", preferredLang: "de" }, settings, inbound });
  ui.switchContact({ id: "account-b/customer", preferredLang: "es" });
  ui.change("auto");
  assert.deepEqual(ui.updates, [{ id: "account-b/customer", patch: { preferredLang: undefined } }]);
  assert.deepEqual(ui.state().translationTarget, { code: "zh", source: "message" });
});

const built = await build({
  stdin: {
    contents: "export { TranslateBar } from './src/components/chat/TranslateBar.tsx';",
    resolveDir: fileURLToPath(new URL("../", import.meta.url)),
  },
  bundle: true, write: false, format: "esm", platform: "node", jsx: "automatic",
  alias: { "@": fileURLToPath(new URL("../src/", import.meta.url)) },
  plugins: [{ name: "translation-auto-ui-mocks", setup(builder) {
    const mocks = {
      "@/i18n": "export const useI18n = () => ({ t: key => key });",
      "lucide-react": "export const Languages = () => null; export const Loader2 = () => null; export const Undo2 = () => null;",
    };
    builder.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: "mock" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path] }));
  } }],
});
const { TranslateBar } = await import("data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64"));
function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node?.props) return [];
  return [node, ...elements(node.props.children)];
}

test("translation bar keeps source in tooltip and moves automatic selection into the language dropdown", () => {
  const calls=[];
  const props={visible:true,hasDraft:true,translateOriginal:null,translating:false,translateLang:'fr',onTranslateLangChange:v=>calls.push(v),onRestoreAuto:()=>calls.push('auto'),onTranslate(){},onRestore(){},onBackTranslate(){},recording:false,recordSec:0};
  for(const source of ['preferred','country','message','default']){
    const tree=elements(TranslateBar({...props,source})),label='translation.source'+source[0].toUpperCase()+source.slice(1);
    assert.ok(!tree.some(n=>n.type==='span'&&n.props.children===label));
    const select=tree.find(n=>n.type==='select');assert.equal(select.props.title,'tooltip.outputLanguage · '+label);
    assert.equal(select.props.value,source==='preferred'?'fr':'auto');
    assert.ok(tree.some(n=>n.type==='option'&&n.props.value==='auto'));
    assert.ok(!tree.some(n=>n.type==='button'&&n.props.children==='translation.restoreAuto'));
    select.props.onChange({target:{value:'auto'}});select.props.onChange({target:{value:'de'}});
  }
  assert.deepEqual(calls,['auto','de','auto','de','auto','de','auto','de']);
  const busy=elements(TranslateBar({...props,source:'preferred',translating:true}));
  const select=busy.find(n=>n.type==='select');assert.equal(select.props.disabled,true);select.props.onChange({target:{value:'auto'}});assert.equal(calls.length,8);
});

test('compact translation tools preserve translate, undo and recording behavior without permanent shortcut text',()=>{
 let translated=0,restored=0,backTranslated=0;
 const props={visible:true,hasDraft:true,translateOriginal:null,translating:false,translateLang:'fr',source:'country',onTranslateLangChange(){},onRestoreAuto(){},onTranslate:()=>translated++,onRestore:()=>restored++,onBackTranslate:()=>backTranslated++,recording:false,recordSec:0};
 let tree=elements(TranslateBar(props));
 const action=tree.find(n=>n.type==='button');assert.match(action.props.title,/Ctrl\+Shift\+T/);action.props.onClick();assert.equal(translated,1);
 assert.equal(tree.filter(n=>n.type==='button').length,1);
 tree=elements(TranslateBar({...props,translateOriginal:'Original',recording:true,recordSec:12}));
 tree.find(n=>n.type==='button'&&n.props.title==='translation.showBack').props.onClick();assert.equal(backTranslated,1);
 tree.find(n=>n.type==='button'&&n.props.title==='tooltip.restoreOriginal').props.onClick();assert.equal(restored,1);
 assert.ok(tree.some(n=>n.type==='span'&&Array.isArray(n.props.children)&&n.props.children[0]===12));
 assert.ok(!tree.some(n=>n.props.children==='translation.shortcuts'));
 const withBack=elements(TranslateBar({...props,translateOriginal:'Original',backTranslation:'Original text'}));
 assert.ok(withBack.some(n=>n.type==='span'&&Array.isArray(n.props.children)&&n.props.children.includes('translation.backLabel')));
 assert.equal(TranslateBar({...props,visible:false}),null);
});
