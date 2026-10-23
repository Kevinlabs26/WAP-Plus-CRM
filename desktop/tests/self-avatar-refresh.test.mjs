import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const mocks = {
  react: "export const useRef=current=>({current}); export const useEffect=fn=>{globalThis.selfAvatarCleanup=fn();};",
  "@/store/appStore": "export const useAppStore=f=>f(globalThis.selfAvatarState); useAppStore.getState=()=>globalThis.selfAvatarState; useAppStore.setState=p=>Object.assign(globalThis.selfAvatarState,typeof p==='function'?p(globalThis.selfAvatarState):p);",
  "@/lib/baileys": `export const baileysSessionEpoch=id=>globalThis.selfAvatarEpochs.get(id)||0;
    export const baileysStatus=async id=>{globalThis.selfAvatarStatusCalls.push(id);return globalThis.selfAvatarStatuses.get(id);};
    export const baileysEvents=async()=>({cursor:0,events:[]});
    export const baileysSync=async()=>({contacts:[],messages:[]});
    export const baileysLabels=async()=>({labels:[]});
    export const baileysFetchAvatar=opts=>globalThis.selfAvatarFetch(opts);`,
  "@/store/persist": "export const persist=()=>{}; export const flushPersist=async()=>{};",
  "@/lib/mediaCache": "export const waitForMediaCacheWrites=async()=>{};",
  "@/lib/composerActivity": "export const isComposerTypingBusy=()=>false;",
  "@/lib/groupJoinNotify": "export const notifyGroupJoinRequests=()=>{};",
  "@/lib/syncDebug": "export const syncLog=()=>{};",
  "@/i18n": "export const useI18n=()=>({t:key=>key});",
};
const built = await build({entryPoints:[fileURLToPath(new URL("../src/components/bridge/BaileysWatcher.tsx",import.meta.url))],bundle:true,write:false,format:"esm",platform:"browser",
  alias:{"@":fileURLToPath(new URL("../src",import.meta.url))},
  plugins:[{name:"self-avatar-boundaries",setup(b){
    b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:"mock"}:undefined);
    b.onLoad({filter:/.*/,namespace:"mock"},a=>({contents:mocks[a.path]}));
  }}],
});
const {BaileysWatcher}=await import("data:text/javascript;base64,"+Buffer.from(built.outputFiles[0].text).toString("base64"));
const settle=async()=>{for(let i=0;i<50;i++)await Promise.resolve();};
const image=value=>"data:image/png;base64,"+Buffer.from(value).toString("base64");
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};

function fixture({count=1,nav="chats"}={}) {
  const globals=["window","document","sessionStorage","requestAnimationFrame","cancelAnimationFrame"];
  const originals=Object.fromEntries(globals.map(k=>[k,globalThis[k]])),originalNow=Date.now;
  let clock=Date.UTC(2026,9,22,10,0,8);
  Date.now=()=>clock;
  const handlers=new Map(),timers=[],intervals=[],requests=[];
  globalThis.window={setTimeout(fn,ms){timers.push({fn,ms});return timers.length;},clearTimeout(){},
    setInterval(fn,ms){intervals.push({fn,ms});return intervals.length;},clearInterval(){},
    addEventListener(k,fn){handlers.set(k,fn);},removeEventListener(k){handlers.delete(k);}};
  globalThis.document={hidden:false,addEventListener(){},removeEventListener(){}};
  globalThis.sessionStorage={getItem:()=>null,setItem(){}};
  globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
  const accounts=Array.from({length:count},(_,i)=>({id:"wa-"+i,label:String(i+1),status:"connected",phoneE164:"+1202555010"+i,avatarUrl:image("old-"+i)}));
  globalThis.selfAvatarStatuses=new Map(accounts.map(a=>[a.id,{connection:"connected",user:{id:a.phoneE164.slice(1)+":7@s.whatsapp.net",name:a.label}}]));
  globalThis.selfAvatarEpochs=new Map();globalThis.selfAvatarStatusCalls=[];
  let response=opts=>Promise.resolve({ok:true,avatarUrl:image("new-"+opts.accountId)});
  globalThis.selfAvatarFetch=opts=>{requests.push(opts);return response(opts);};
  globalThis.selfAvatarState={hydrated:true,uiReady:true,activeNav:nav,
    settings:{sendChannel:"baileys",waAccounts:accounts,activeAccountId:"wa-0",liveBaileysAccountId:"wa-0"},
    phones:[],contacts:[],chats:[],messages:[],baileysUi:{},ingestBridgeEvents:async()=>{},pushToast(){},
    setBaileysUi(){},setBaileysLoginOpen(){},syncWhatsAppLabels(){},updateSettings(p){Object.assign(this.settings,p);}};
  BaileysWatcher();
  return {requests,
    account(id="wa-0"){return selfAvatarState.settings.waAccounts.find(a=>a.id===id);},
    respond(fn){response=fn;},advance(ms){clock+=ms;},
    async first(){timers.find(t=>t.ms===1500).fn();await settle();},
    async poll(force=false){if(force)handlers.get("wap:refresh-account-status")();else intervals.find(t=>t.ms===2500).fn();await settle();},
    stop(){selfAvatarCleanup();},
    close(){selfAvatarCleanup();Date.now=originalNow;for(const key of globals)globalThis[key]=originals[key];
      for(const key of ["selfAvatarCleanup","selfAvatarState","selfAvatarStatuses","selfAvatarEpochs","selfAvatarStatusCalls","selfAvatarFetch"])delete globalThis[key];},
  };
}

test("a cached self avatar is refreshed on the first connected poll and normal polls stay throttled",async()=>{
  const ui=fixture();try {
    await ui.first();assert.equal(ui.requests.length,1);assert.equal(ui.account().avatarUrl,image("new-wa-0"));
    assert.equal(ui.requests[0].self,true);assert.equal(ui.requests[0].force,true);assert.equal(ui.requests[0].jid,"12025550100@s.whatsapp.net");
    ui.advance(45_000);await ui.poll();assert.equal(ui.requests.length,1);
    ui.advance(255_000);await ui.poll();assert.equal(ui.requests.length,2);
  }finally{ui.close();}
});

test("opening devices refreshes every connected account sooner, even in a background status skip window",async()=>{
  const ui=fixture({count:2});try {
    await ui.first();ui.requests.length=0;selfAvatarStatusCalls.length=0;
    selfAvatarState.activeNav="phones";ui.advance(48_000);await ui.poll(true);
    assert.deepEqual(selfAvatarStatusCalls.sort(),["wa-0","wa-1"]);
    assert.deepEqual(ui.requests.map(r=>r.accountId).sort(),["wa-0","wa-1"]);
    assert.equal(ui.account("wa-0").avatarUrl,image("new-wa-0"));assert.equal(ui.account("wa-1").avatarUrl,image("new-wa-1"));
    await ui.poll(true);assert.equal(ui.requests.length,2);
  }finally{ui.close();}
});

test("slow avatar requests do not overlap and a failed request preserves the old photo and can retry",async()=>{
  const ui=fixture({nav:"phones"}),pending=deferred();try {
    ui.respond(()=>pending.promise);await ui.first();ui.advance(60_000);await ui.poll(true);assert.equal(ui.requests.length,1);
    pending.resolve({ok:false,avatarUrl:""});await settle();assert.equal(ui.account().avatarUrl,image("old-0"));
    ui.respond(()=>Promise.reject(new Error("network unavailable")));await ui.poll(true);assert.equal(ui.requests.length,2);
    assert.equal(ui.account().avatarUrl,image("old-0"));
    ui.advance(45_000);ui.respond(()=>Promise.resolve({ok:true,avatarUrl:image("recovered")}));await ui.poll(true);
    assert.equal(ui.account().avatarUrl,image("recovered"));
  }finally{ui.close();}
});

test("old avatar responses cannot overwrite a replaced session, changed number, removed account or stopped watcher",async()=>{
  for(const scenario of ["session","number","removed","stopped"]) {
    const ui=fixture(),pending=deferred();try {
      ui.respond(()=>pending.promise);await ui.first();
      if(scenario==="session")selfAvatarEpochs.set("wa-0",1);
      if(scenario==="number")ui.account().phoneE164="+12025550109";
      if(scenario==="removed")selfAvatarState.settings.waAccounts=[];
      if(scenario==="stopped")ui.stop();
      pending.resolve({ok:true,avatarUrl:image("stale-response")});await settle();
      if(scenario==="removed")assert.equal(ui.account(),undefined);
      else assert.equal(ui.account().avatarUrl,image("old-0"),scenario);
    }finally{ui.close();}
  }
});

test("disconnected, pairing and reconnecting accounts keep their photo without sending an avatar request",async()=>{
  for(const connection of ["close","qr","reconnecting","logged_out"]) {
    const ui=fixture();try {
      selfAvatarStatuses.set("wa-0",{connection,user:null});await ui.first();
      assert.deepEqual(ui.requests,[]);assert.equal(ui.account().avatarUrl,image("old-0"));
    }finally{ui.close();}
  }
});
