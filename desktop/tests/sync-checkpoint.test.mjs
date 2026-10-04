import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
const mocks = {
  react: "export const useRef = current => ({current}); export const useEffect = fn => { globalThis.syncCleanup = fn(); };",
  "@/store/appStore": "export const useAppStore = selector => selector(globalThis.syncState); useAppStore.getState = () => globalThis.syncState; useAppStore.setState = patch => Object.assign(globalThis.syncState, typeof patch === 'function' ? patch(globalThis.syncState) : patch);",
  "@/lib/baileys": "export const baileysEvents = async () => globalThis.syncResponses.shift() || {cursor: 11, events: []}; export const baileysStatus = async () => ({connection:'starting'}); export const baileysSync = async () => ({contacts:[],messages:[]}); export const baileysLabels = async () => ({labels:[]}); export const baileysFetchAvatar = async () => null;",
  "@/store/persist": "export const persist = () => {}; export const flushPersist = () => new Promise(resolve => {globalThis.syncSaveResolve = resolve;});",
  "@/lib/mediaCache": "export const waitForMediaCacheWrites = async () => {};",
  "@/lib/composerActivity": "export const isComposerTypingBusy = () => false;",
  "@/lib/groupJoinNotify": "export const notifyGroupJoinRequests = () => {};",
  "@/lib/syncDebug": "export const syncLog = () => {};",
  "@/i18n": "export const useI18n = () => ({t: key => key});",
};
const result = await build({ entryPoints: [fileURLToPath(new URL('../src/components/bridge/BaileysWatcher.tsx', import.meta.url))], bundle: true, format: 'esm', platform: 'browser', write: false, plugins: [{name:'sync-mocks',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'js'}));}}], alias:{'@':fileURLToPath(new URL('../src',import.meta.url))} });
const { BaileysWatcher } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
const settle = async () => { for(let i=0;i<30;i++) await Promise.resolve(); };
test('checkpoint waits for every ingest and save; changed contact batches and empty polls cannot skip data', async () => {
  const timers=[], frames=[], handlers=new Map(), cursors=new Map(), received=[], errors=[];
  globalThis.window = { setTimeout(fn,ms){timers.push({fn,ms});return timers.length;}, clearTimeout(){},setInterval(){return 1;},clearInterval(){},addEventListener(k,fn){handlers.set(k,fn);},removeEventListener(){} };
  globalThis.document = {hidden:false, addEventListener(){},removeEventListener(){}};
  globalThis.requestAnimationFrame = fn => {frames.push(fn);return frames.length;}; globalThis.cancelAnimationFrame=()=>{};
  globalThis.sessionStorage = {getItem:k=>cursors.get(k)||null,setItem:(k,v)=>cursors.set(k,v)};
  globalThis.syncState = {hydrated:true,uiReady:true,activeNav:'chats',settings:{sendChannel:'baileys',waAccounts:[{id:'wa-a',label:'A',status:'connected'}],activeAccountId:'wa-a',liveBaileysAccountId:'wa-a'},phones:[],contacts:[],chats:[],messages:[],baileysUi:{}, ingestBridgeEvents: events => {received.push(events); return new Promise(resolve=>{globalThis.syncIngestResolve=resolve;});},pushToast:(text,kind)=>{if(kind==='error')errors.push(text);},setBaileysUi(){},setBaileysLoginOpen(){},syncWhatsAppLabels(){},updateSettings(patch){Object.assign(this.settings,patch);} };
  const event = name => ({type:'contacts.sync',deviceId:'wa-a',payload:{items:Array.from({length:11},(_,i)=>({id:String(i),name}))}});
  globalThis.syncResponses = [{cursor:10,events:[event('first')]},{cursor:10,events:[]},{cursor:11,events:[event('updated')]}];
  BaileysWatcher();
  try {
    timers.find(t=>t.ms===1500).fn(); await settle();
    assert.deepEqual(errors,[]);
    timers.find(t=>t.ms===40).fn(); frames.shift()(); await settle();
    assert.equal(received.flat().flatMap(e=>e.payload.items).length,11);
    assert.equal(cursors.size,0);
    handlers.get('wap:refresh-account-status')(); await settle();
    assert.equal(cursors.size,0);
    handlers.get('wap:refresh-account-status')(); await settle();
    timers.filter(t=>t.ms===40).at(-1).fn();
    globalThis.syncIngestResolve(); await settle();
    frames.shift()(); await settle();
    assert.equal(received.flat().flatMap(e=>e.payload.items).filter(i=>i.name==='updated').length,11);
    assert.equal(cursors.size,0);
    globalThis.syncIngestResolve(); await settle();
    assert.equal(cursors.size,0);
    globalThis.syncSaveResolve(); await settle();
    assert.equal(cursors.get('wap.baileys.eventCursor.wa-a'),'11');
  } finally { globalThis.syncCleanup(); }
});
