import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { resolvePhoneCountry, countryDisplayName, countryLocalTimes } from "../src/lib/contactTime.ts";
import { translate } from "../src/i18n/core.ts";

test("international numbers resolve offline, including shared calling codes and existing JID/format variants", () => {
  for (const [phone, country] of [
    ["+212600000000", "MA"], ["212 600 000 000", "MA"], ["00212600000000", "MA"],
    ["+243810000000", "CD"], ["+12025550100", "US"], ["+14165550100", "CA"],
    ["+44 20 7946 0018", "GB"], ["212600000000:2@s.whatsapp.net", "MA"],
  ]) assert.equal(resolvePhoneCountry({ phone })?.id, country, phone);
  assert.equal(resolvePhoneCountry({ phone: "", channelAddress: "212600000000@s.whatsapp.net" })?.id, "MA");
  assert.equal(countryDisplayName("MA", "Morocco", "zh-CN"), "摩洛哥");
  assert.equal(countryDisplayName("MA", "Morocco", "fr"), "Maroc");
});

test("unknown numbers, local prefixes, non-geographic numbers, groups and LIDs never get a guessed country", () => {
  for (const phone of ["", "+123", "0612345678", "+999123456789", "+80012345678", "123456789012345@lid", "Call +212600000000", "1".repeat(1000)]) {
    assert.equal(resolvePhoneCountry({ phone }), undefined, phone);
  }
  assert.equal(resolvePhoneCountry({ phone: "+212600000000", isGroup: true }), undefined);
  assert.equal(resolvePhoneCountry({ phone: "+212600000000", channelAddress: "123@g.us" }), undefined);
});

test("local times respect winter/summer rules and preserve both Congolese time zones", () => {
  assert.equal(countryLocalTimes(["Europe/Paris"], "en", Date.parse("2026-01-15T12:00:00Z"))[0].time, "13:00");
  assert.equal(countryLocalTimes(["Europe/Paris"], "en", Date.parse("2026-07-15T12:00:00Z"))[0].time, "14:00");
  assert.equal(countryLocalTimes(["Africa/Casablanca"], "en", Date.parse("2026-02-25T12:00:00Z"))[0].time, "12:00");
  assert.equal(countryLocalTimes(["Africa/Casablanca"], "en", Date.parse("2026-07-15T12:00:00Z"))[0].time, "13:00");
  const congo = resolvePhoneCountry({ phone: "+243810000000" });
  assert.deepEqual(countryLocalTimes(congo.timezones, "en", Date.parse("2026-10-26T12:00:00Z")).map(t => t.time), ["13:00", "14:00"]);
  const us = resolvePhoneCountry({ phone: "+12025550100" });
  const times = countryLocalTimes(us.timezones, "en", Date.parse("2026-10-26T12:00:00Z"));
  assert.ok(times.length > 1 && times.length < us.timezones.length, "deduplicate equal current times, not all regions into one time");
});

test("same clock time on different dates remains distinct; unsupported zones never fall back to the user's clock", () => {
  const now = Date.parse("2026-01-01T12:00:00Z");
  const times = countryLocalTimes(["Etc/GMT+12", "Etc/GMT-12"], "en", now);
  assert.equal(times.length, 2);
  assert.deepEqual(times.map(t => t.time), ["00:00", "00:00"]);
  assert.notEqual(times[0].label, times[1].label);
  assert.ok(times.some(t => /01\/02/.test(t.shortLabel)), "show the different local date in the compact row");
  assert.deepEqual(countryLocalTimes(["Unsupported/Zone"], "en", now), []);
  assert.equal(countryLocalTimes(["Unsupported/Zone", "Europe/Paris"], "en", now).length, 1);
  assert.deepEqual(countryLocalTimes(["Europe/Paris"], "en", NaN), []);
});

const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/components/crm/ContactLocalTime.tsx", import.meta.url))],
  bundle: true, format: "esm", platform: "browser", write: false, jsx: "automatic",
  alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
  plugins: [{ name: "clock-boundaries", setup(b) {
    b.onResolve({ filter: /^(react(?:\/jsx-runtime)?|@\/i18n)$/ }, args => ({ path: args.path, namespace: "mock" }));
    b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: args.path === "react/jsx-runtime"
      ? "export const jsx = (type, props) => ({type, props}); export const jsxs = jsx; export const Fragment = 'fragment';"
      : args.path === "react" ? "export const useEffect=(...a)=>globalThis.clockHooks.useEffect(...a); export const useMemo=(...a)=>globalThis.clockHooks.useMemo(...a); export const useState=(...a)=>globalThis.clockHooks.useState(...a); export const forwardRef=fn=>fn; export const createElement=()=>null;"
      : "export const useI18n=()=>({locale:'en',t:(key,params)=>globalThis.clockTranslate(key,params)});" }));
  } }],
});
const { ContactLocalTime } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

test("profile clock ticks at minute boundaries, refreshes on focus and clears timers when changing to a hidden LID", t => {
  let now = Date.parse("2026-10-26T12:00:00Z");
  t.mock.method(Date, "now", () => now);
  const previous = { window: globalThis.window, document: globalThis.document };
  t.after(() => { globalThis.window = previous.window; globalThis.document = previous.document; delete globalThis.clockHooks; delete globalThis.clockTranslate; });
  const timers = new Map(), events = new Map(), slots = []; let cursor = 0, timerId = 0, effects = [];
  const different = (a, b) => !a || a.some((item, i) => !Object.is(item, b[i]));
  globalThis.clockTranslate = (key, params) => translate("en", key, params);
  globalThis.clockHooks = {
    useMemo(fn, deps) { const i = cursor++; if (!slots[i] || different(slots[i].deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
    useState(initial) { const i = cursor++; slots[i] ||= { value: typeof initial === "function" ? initial() : initial }; return [slots[i].value, value => { slots[i].value = value; }]; },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || different(slots[i].deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
  };
  globalThis.window = {
    setTimeout(fn, delay) { timers.set(++timerId, { fn, delay }); return timerId; }, clearTimeout(id) { timers.delete(id); },
    addEventListener(name, fn) { events.set(name, fn); }, removeEventListener(name) { events.delete(name); },
  };
  globalThis.document = { addEventListener: window.addEventListener, removeEventListener: window.removeEventListener };
  const render = phone => { cursor = 0; const view = ContactLocalTime({ contact: { phone } }); const pending = effects; effects = []; pending.forEach(fn => fn()); return view; };
  const text = view => typeof view === "string" ? view : Array.isArray(view) ? view.map(text).join(" ") : view?.props ? text(view.props.children) : "";
  assert.ok(text(render("+212600000000")).includes("Morocco"));
  assert.equal(timers.size, 1);
  assert.ok([...timers.values()][0].delay <= 60_020);
  now += 60_000; [...timers.values()][0].fn();
  assert.ok(text(render("+212600000000")).includes("13:01"));
  now += 3600_000; events.get("focus")();
  assert.ok(text(render("+212600000000")).includes("14:01"));
  assert.equal(render("+243810000000").type, "details");
  assert.equal(timers.size, 1);
  assert.equal(render("123456789012345@lid"), null);
  assert.equal(timers.size, 0);
  assert.equal(events.size, 0);
});
