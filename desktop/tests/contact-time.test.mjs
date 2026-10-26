import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { resolvePhoneCountry, countryDisplayName, countryLocalTimes } from "../src/lib/contactTime.ts";
import { translate } from "../src/i18n/core.ts";
import { getCountries, getCountryCallingCode, getExampleNumber } from "libphonenumber-js/min";
import examples from "libphonenumber-js/examples.mobile.json";

test("international numbers resolve offline, including shared calling codes and existing JID/format variants", () => {
  for (const [phone, country] of [
    ["+212600000000", "MA"], ["212 600 000 000", "MA"], ["00212600000000", "MA"],
    ["+243810000000", "CD"], ["+12025550100", "US"], ["+14165550100", "CA"],
    ["+44 20 7946 0018", "GB"], ["212600000000:2@s.whatsapp.net", "MA"],
    ["+22521234567", "CI"], ["+2250123456789", "CI"],
  ]) assert.equal(resolvePhoneCountry({ phone })?.id, country, phone);
  assert.equal(resolvePhoneCountry({ phone: "", channelAddress: "212600000000@s.whatsapp.net" })?.id, "MA");
  assert.equal(countryDisplayName("MA", "Morocco", "zh-CN"), "摩洛哥");
  assert.equal(countryDisplayName("MA", "Morocco", "fr"), "Maroc");
});

test("every region in the installed global phone metadata displays its country or shared numbering-plan region", () => {
  const countries = getCountries();
  for (const code of countries) {
    const number = getExampleNumber(code, examples);
    assert.ok(number, `missing library example for ${code}`);
    const contact = { phone: number.number };
    const resolved = resolvePhoneCountry(contact);
    assert.ok(resolved, `country hidden for ${code}`);
    // 一些地区共享号码计划，不能从手机号保证区分，例如芬兰与奥兰群岛。
    assert.equal(getCountryCallingCode(resolved.id), getCountryCallingCode(code), code);
    assert.equal(contact.phone, number.number, "country display never rewrites the saved number");
  }
  assert.ok(countries.length >= 240);
  for (const code of ["AC", "TA", "XK"]) {
    const country = resolvePhoneCountry({ phone: getExampleNumber(code, examples).number });
    assert.equal(country.id, code);
    assert.deepEqual(country.timezones, [], "keep the country even when no timezone data is available");
  }
});

test("unique calling codes support legacy length differences across countries without guessing shared codes", () => {
  for (const [phone, code] of [
    ["+22521234567", "CI"], ["+22177123456", "SN"], ["+2289012345", "TG"],
    ["+2267012345", "BF"], ["+234801234567", "NG"], ["+2162012345", "TN"],
    ["+3371234567", "FR"], ["+5215512345678", "MX"],
  ]) assert.equal(resolvePhoneCountry({ phone })?.id, code, phone);
  for (const phone of ["+1202555123", "+44740012345", "+21261234567"]) {
    assert.equal(resolvePhoneCountry({ phone }), undefined, `ambiguous incomplete shared plan: ${phone}`);
  }
});

test("unknown numbers, local prefixes, non-geographic numbers, groups and LIDs never get a guessed country", () => {
  for (const phone of ["", "+123", "+22512345", "+22501234567890123", "0612345678", "+999123456789", "+80012345678", "123456789012345@lid", "Call +212600000000", "1".repeat(1000)]) {
    assert.equal(resolvePhoneCountry({ phone }), undefined, phone);
  }
  assert.equal(resolvePhoneCountry({ phone: "+212600000000", isGroup: true }), undefined);
  assert.equal(resolvePhoneCountry({ phone: "+212600000000", channelAddress: "123@g.us" }), undefined);
});

test("choosing a region stays correct when zones that share today's clock diverge for daylight saving", () => {
  const zones = ["America/Denver", "America/Phoenix"];
  const winter = countryLocalTimes(zones, "en", Date.parse("2026-01-15T12:00:00Z"));
  assert.equal(winter.length, 1);
  assert.deepEqual(winter[0].timeZones, zones);
  const summer = countryLocalTimes(zones, "en", Date.parse("2026-07-15T12:00:00Z"));
  assert.equal(summer.length, 2);
  assert.equal(summer.find(time => time.timeZones.includes("America/Phoenix")).time, "05:00");
  assert.equal(summer.find(time => time.timeZones.includes("America/Denver")).time, "06:00");
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
    b.onResolve({ filter: /^(react(?:\/jsx-runtime)?|@\/i18n|@\/store\/appStore)$/ }, args => ({ path: args.path, namespace: "mock" }));
    b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: args.path === "react/jsx-runtime"
      ? "export const jsx = (type, props) => ({type, props}); export const jsxs = jsx; export const Fragment = 'fragment';"
      : args.path === "react" ? "export const useId=()=> 'clock-fixture'; export const useEffect=(...a)=>globalThis.clockHooks.useEffect(...a); export const useMemo=(...a)=>globalThis.clockHooks.useMemo(...a); export const useState=(...a)=>globalThis.clockHooks.useState(...a); export const forwardRef=fn=>fn; export const createElement=()=>null;"
      : args.path === "@/store/appStore" ? "export const useAppStore=selector=>selector({updateContact:(...a)=>globalThis.clockUpdateContact(...a)});"
      : "export const useI18n=()=>({locale:'en',t:(key,params)=>globalThis.clockTranslate(key,params)});" }));
  } }],
});
const { ContactLocalTime } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

test("profile clock ticks at minute boundaries, refreshes on focus and clears timers when changing to a hidden LID", t => {
  let now = Date.parse("2026-10-26T12:00:00Z");
  t.mock.method(Date, "now", () => now);
  const previous = { window: globalThis.window, document: globalThis.document };
  t.after(() => { globalThis.window = previous.window; globalThis.document = previous.document; delete globalThis.clockHooks; delete globalThis.clockTranslate; delete globalThis.clockUpdateContact; });
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
  const render = value => { cursor = 0; const view = ContactLocalTime({ contact: typeof value === 'string' ? { id: value, phone: value } : value }); const pending = effects; effects = []; pending.forEach(fn => fn()); return view; };
  const text = view => typeof view === "string" ? view : Array.isArray(view) ? view.map(text).join(" ") : view?.props ? text(view.props.children) : "";
  assert.ok(text(render("+212600000000")).includes("Morocco"));
  assert.ok(!text(render("+212600000000")).includes("Estimate"));
  assert.equal(timers.size, 1);
  assert.ok([...timers.values()][0].delay <= 60_020);
  now += 60_000; [...timers.values()][0].fn();
  assert.ok(text(render("+212600000000")).includes("13:01"));
  now += 3600_000; events.get("focus")();
  assert.ok(text(render("+212600000000")).includes("14:01"));
  assert.equal(render("+243810000000").type, "details");
  assert.equal(timers.size, 1);
  const a = { id: 'person-a', phone: '+243810000000' }, b = { id: 'person-b', phone: '+243810000000' };
  const contacts = [a, b], updates = [];
  globalThis.clockUpdateContact = (id, patch) => { updates.push([id, patch]); Object.assign(contacts.find(c => c.id === id), patch); };
  const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
  let view = render(a);
  const choices = nodes(view).filter(n => n.type === 'input');
  assert.equal(choices.length, 3); // Automatic plus both Congolese zones.
  const details = { open: true };
  choices[1].props.onChange({ currentTarget: { closest: () => details } });
  assert.equal(details.open, false);
  assert.equal(updates[0][0], a.id);
  assert.equal(a.timeZone, 'Africa/Lagos');
  view = render(a);
  const summary = nodes(view).find(n => n.type === 'summary');
  assert.ok(!text(summary).includes(' / '));
  assert.ok(!text(summary).includes('Multiple zones'));
  assert.ok(!text(view).includes('Reference times for the phone'));
  assert.equal(nodes(view).filter(n => n.type === 'input')[1].props.checked, true);
  assert.ok(text(nodes(render(b)).find(n => n.type === 'summary')).includes(' / '));
  view = render(a);
  nodes(view).find(n => n.type === 'input').props.onChange({ currentTarget: { closest: () => details } });
  assert.equal(a.timeZone, undefined);
  assert.ok(text(nodes(render(a)).find(n => n.type === 'summary')).includes(' / '));
  a.timeZone = 'Europe/Paris';
  assert.ok(text(nodes(render(a)).find(n => n.type === 'summary')).includes(' / '), 'ignore saved zones from a different country');
  assert.ok(render(getExampleNumber('AC', examples).number), 'a region without timezone metadata still shows its country');
  assert.equal(timers.size, 0);
  assert.equal(events.size, 0);
  assert.equal(render("123456789012345@lid"), null);
  assert.equal(timers.size, 0);
  assert.equal(events.size, 0);
});
