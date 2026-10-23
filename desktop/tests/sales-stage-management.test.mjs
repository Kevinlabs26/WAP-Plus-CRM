import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { translate } from "../src/i18n/core.ts";

const mocks = {
  react: "export const useMemo=fn=>fn(); export const useState=v=>globalThis.stageHooks.state(v); export const useRef=v=>globalThis.stageHooks.ref(v); export const useEffect=(fn,deps)=>globalThis.stageHooks.effect(fn,deps);",
  "react/jsx-runtime": "export const jsx=(type,props,key)=>({type,props,key}); export const jsxs=jsx;",
  "lucide-react": ["ArrowDown","ArrowUp","Plus","Trash2","X"].map(name=>`export const ${name}=()=>null;`).join(""),
  "@/store/appStore": "export const useAppStore=selector=>selector(globalThis.stageState);useAppStore.getState=()=>globalThis.stageState;",
  "@/i18n": "export const useI18n=()=>({t:(key,params)=>globalThis.stageTranslate(key,params)});",
  "@/components/ui/primitives": "export const Button='button',Input='input';",
  "@/lib/storage": "export const getStorageEngine=()=> 'idb';export const saveSecureSecrets=async()=>true;export const registerChatMessageReplacements=()=>{};export const clearStoredRemoteMessages=async()=>{};export const deleteStoredMessagesByKeys=async()=>{};export const updateStoredMessageAcks=async()=>{};export const clearStoredChatMessages=async()=>{};export const getMessageFromDb=async()=>null;export const searchMessagesInDb=async()=>null;",
  "./persist": "export const persist=(get,immediate)=>globalThis.stageSaves.push({contacts:get().contacts,settings:get().settings,immediate});export const scheduleStatsRecompute=()=>{};export const accountCreatedAtOf=()=>undefined;",
  "./exportDataActions": "export const exportBackup=()=>{};export const exportContactsCsv=()=>{};",
  "./restoreGuard": "export const deferDuringRestore=()=>false;export const isDataRestoreActive=()=>Boolean(globalThis.stageRestoring);",
  "@/lib/mediaCache": "export const bridgeMessageMediaCacheId=(id,account)=>account+':'+id;export const cacheMediaUrl=async()=>{};export const dropMediaCache=async()=>{};",
  "@/lib/composerActivity": "export const isComposerTypingBusy=()=>false;",
  "@/lib/syncDebug": "export const noteMainThreadWork=()=>{};export const syncLog=()=>{};export const isSyncDebugEnabled=()=>false;",
  "@/lib/aiAutoReply": "export const emitLiveInboundMessages=()=>{};",
  "@/lib/inboundMessageNotify": "export const notifyInboundMessages=()=>{};",
};
const built=await build({stdin:{contents:`export * from './src/lib/contactWorkflow.ts';
  export {SalesStageManager} from './src/components/crm/SalesStageManager.tsx';
  export {SalesStageField} from './src/components/crm/SalesStageField.tsx';
  export {createSettingsActionsSlice} from './src/store/settingsActionsSlice.ts';
  export {createContactCreationActions} from './src/store/contactCreationActions.ts';
  export {createContactActions} from './src/store/contactActions.ts';
  export {createBroadcastSlice} from './src/store/broadcastSlice.ts';
  export {createIngestSlice} from './src/store/ingestSlice.ts';
  export {defaultSettings,normalizeLoadedSettings} from './src/store/settingsDefaults.ts';`,resolveDir:fileURLToPath(new URL("../",import.meta.url))},
  bundle:true,write:false,format:"esm",platform:"browser",jsx:"automatic",
  alias:{"@":fileURLToPath(new URL("../src",import.meta.url)),"@shared":fileURLToPath(new URL("../../shared",import.meta.url))},
  plugins:[{name:"stage-boundaries",setup(b){b.onResolve({filter:/.*/},args=>mocks[args.path]?{path:args.path,namespace:"mock"}:undefined);b.onLoad({filter:/.*/,namespace:"mock"},args=>({contents:mocks[args.path]}));}}],
});
const mod=await import("data:text/javascript;base64,"+Buffer.from(built.outputFiles[0].text).toString("base64"));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree?.props?[tree,...nodes(tree.props.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(""):tree?.props?text(tree.props.children):typeof tree==="string"||typeof tree==="number"?String(tree):"";
const byLabel=(tree,label)=>nodes(tree).find(node=>node.props["aria-label"]===label);
const button=(tree,label)=>nodes(tree).find(node=>node.type==="button"&&text(node)===label);

function fixture() {
  const cells=[],effects=[],toasts=[],activities=[];
  let cursor=0;
  globalThis.stageHooks={state(initial){const i=cursor++;cells[i]??={value:typeof initial==='function'?initial():initial};return[cells[i].value,next=>{cells[i].value=typeof next==='function'?next(cells[i].value):next;}];},
    ref(initial){return cells[cursor++]??={current:initial};},effect(fn,deps){const i=cursor++;if(cells[i])return;cells[i]={};effects.push(()=>{cells[i].cleanup=fn();});}};
  globalThis.stageTranslate=(key,params)=>translate("zh-CN",key,params);
  globalThis.stageSaves=[];globalThis.stageRestoring=false;
  const contacts=[{id:"a",accountId:"wa-a",name:"First",phone:"+12025550100",stage:"new",tags:["vip"],notes:"Keep notes"},
    {id:"b",accountId:"wa-b",name:"Second",phone:"+12025550101",stage:"new",tags:[],company:"Keep company"},
    {id:"c",accountId:"wa-b",name:"Third",phone:"+12025550102",stage:"won",tags:[]}];
  globalThis.stageState={hydrated:false,contacts,chats:[],messages:[],phones:[],followUps:[{id:"follow",contactId:"a",note:"Keep reminder"}],activities:[],peerPresenceByKey:{},stats:{},messagesByChatId:{},baileysUi:{},broadcastCampaigns:[],
    settings:{...mod.defaultSettings,uiLanguage:"zh-CN",activeAccountId:"wa-a",liveBaileysAccountId:"wa-a",salesStageLabels:{},salesStageOrder:["new","contacted","quoting","won","after_sales"]},
    selectedChatId:null,selectedContactId:null,pushToast:(...args)=>toasts.push(args),logActivity:(...args)=>activities.push(args),recomputeStats(){},setSelectedPhone(){}};
  const ctx={get:()=>stageState,set:patch=>Object.assign(stageState,typeof patch==='function'?patch(stageState):patch)};
  Object.assign(stageState,mod.createSettingsActionsSlice(ctx),mod.createIngestSlice(ctx),mod.createBroadcastSlice(ctx));
  const resolveStage=stage=>mod.resolveActiveSalesStage(stage,stageState.settings.salesStageOrder);
  Object.assign(stageState,mod.createContactCreationActions({resolveStage,setState:ctx.set,setSelection(){},setActiveChats(){},logActivity(){},recomputeStats(){},persist:()=>{}}),
    mod.createContactActions({resolveStage,getContacts:()=>stageState.contacts,getPhones:()=>[],setState:ctx.set,setSelectedPhone(){},logActivity:(...args)=>activities.push(args),stageLabel:stage=>stage,recomputeStats(){},persist(){}}));
  return {toasts,activities,ctx,
    render(Component=mod.SalesStageManager,props={onClose(){}}){cursor=0;return Component(props);},
    effects,cells,
    close(){for(const cell of cells)cell?.cleanup?.();for(const key of ["stageHooks","stageTranslate","stageSaves","stageState","stageRestoring"])delete globalThis[key];},
  };
}

test("deleting a preset stage atomically migrates all accounts, retains records and persists both changes together",()=>{
  const ui=fixture();try {
    const old=stageState.contacts,followUps=stageState.followUps,chats=stageState.chats;
    assert.equal(stageState.deleteSalesStage("new","contacted"),true);
    assert.deepEqual(stageState.contacts.map(c=>c.stage),["contacted","contacted","won"]);
    assert.deepEqual(stageState.contacts[0],{...old[0],stage:"contacted"});assert.deepEqual(stageState.contacts[1],{...old[1],stage:"contacted"});
    assert.equal(stageState.contacts[2],old[2]);assert.equal(stageState.followUps,followUps);assert.equal(stageState.chats,chats);
    assert.equal(stageState.settings.salesStageOrder.includes("new"),false);assert.equal(ui.activities.length,2);
    assert.equal(stageSaves.length,1);assert.equal(stageSaves[0].immediate,true);assert.equal(stageSaves[0].contacts[0].stage,"contacted");assert.equal(stageSaves[0].settings.salesStageOrder.includes("new"),false);
    const restored=mod.normalizeLoadedSettings(stageState.settings);assert.equal(restored.salesStageOrder.includes("new"),false);
  }finally{ui.close();}
});

test("the last stage, an invalid destination, a stale deleted stage and restore-in-progress cannot delete contacts or stages",()=>{
  const ui=fixture();try {
    const beforeContacts=stageState.contacts,beforeSettings=stageState.settings;
    for(const [source,target] of [["new","new"],["new","gone"],["gone","contacted"]])assert.equal(stageState.deleteSalesStage(source,target),false);
    stageRestoring=true;assert.equal(stageState.deleteSalesStage("new","contacted"),false);stageRestoring=false;
    assert.equal(stageState.contacts,beforeContacts);assert.equal(stageState.settings,beforeSettings);assert.deepEqual(stageSaves,[]);
    stageState.settings={...stageState.settings,salesStageOrder:["contacted"]};assert.equal(stageState.deleteSalesStage("contacted","new"),false);
  }finally{ui.close();}
});

test("manager requires a chosen migration destination, supports cancellation, and reads late arriving contacts at confirmation",()=>{
  const ui=fixture();try {
    let tree=ui.render();byLabel(tree,"删除阶段 · 新客户").props.onClick();tree=ui.render();
    assert.equal(button(tree,"删除阶段").props.disabled,true);assert.equal(stageState.settings.salesStageOrder.includes("new"),true);
    button(tree,"取消").props.onClick();tree=ui.render();assert.equal(button(tree,"删除阶段"),undefined);
    byLabel(tree,"删除阶段 · 新客户").props.onClick();tree=ui.render();nodes(tree).find(n=>n.type==="select").props.onChange({target:{value:"quoting"}});tree=ui.render();
    stageState.contacts=[...stageState.contacts,{id:"late",name:"Late",stage:"new",tags:[]}];
    button(tree,"删除阶段").props.onClick();assert.equal(stageState.contacts.find(c=>c.id==="late").stage,"quoting");assert.equal(stageState.contacts.filter(c=>c.stage==="new").length,0);
  }finally{ui.close();}
});

test("manager renames preset stages without changing their identity, adds stages and saves their order",()=>{
  const ui=fixture();try {
    let tree=ui.render();const input=byLabel(tree,"阶段名称 · 新客户");input.props.onChange({target:{value:"潜在客户"}});tree=ui.render();byLabel(tree,"阶段名称 · 新客户").props.onBlur({target:{value:"潜在客户"}});
    assert.equal(stageState.settings.salesStageLabels.new,"潜在客户");assert.equal(stageState.contacts[0].stage,"new");
    tree=ui.render();byLabel(tree,"上移阶段 · 已联系").props.onClick();assert.deepEqual(stageState.settings.salesStageOrder.slice(0,2),["contacted","new"]);
    tree=ui.render();byLabel(tree,"添加阶段").props.onChange({target:{value:"复购"}});tree=ui.render();nodes(tree).find(n=>n.type==="form").props.onSubmit({preventDefault(){}});
    const id=stageState.settings.salesStageOrder.at(-1);assert.match(id,/^stage_[a-f0-9]{32}$/);assert.equal(stageState.settings.salesStageLabels[id],"复购");
  }finally{ui.close();}
});

test("stage selectors show the same renamed, custom and deleted stage configuration",()=>{
  const ui=fixture();try {
    stageState.settings.salesStageOrder=["custom","won"];stageState.settings.salesStageLabels={custom:"复购",won:"已签约"};
    const tree=ui.render(mod.SalesStageField,{value:"custom",onChange(){}});
    assert.deepEqual(nodes(tree).filter(n=>n.type==="option").map(n=>[n.props.value,text(n)]),[["custom","复购"],["won","已签约"]]);assert.ok(button(tree,"管理销售阶段"));
  }finally{ui.close();}
});

test("manual creation, imports, updates, bridge contacts and new messages honor deletion of the New customer stage",async()=>{
  const ui=fixture();try {
    stageState.deleteSalesStage("new","contacted");
    const input={name:"Manual",phone:"+12025550103",accountId:"wa-a",tags:[],stage:"new"};stageState.addContact(input);stageState.importContacts([{...input,name:"Imported",phone:"+12025550104"}]);
    stageState.updateContact("c",{stage:"new"});stageState.batchUpdateContacts(["a"],{stage:"gone"});
    const campaign=stageState.createBroadcastCampaign({accountId:"wa-a",template:"Hello",contactIds:[],phoneNumbers:["+12025550107"]});
    assert.equal(campaign.ok,true);assert.equal(stageState.contacts.find(c=>c.phone==="+12025550107").stage,"contacted");
    await stageState.ingestBridgeEvents([{type:"contacts.sync",deviceId:"wa-a",payload:{items:[{jid:"12025550105@s.whatsapp.net",phoneE164:"+12025550105",name:"Synced"}]}},
      {type:"messages.sync",deviceId:"wa-a",payload:{items:[{id:"msg",jid:"12025550106@s.whatsapp.net",phoneE164:"+12025550106",body:"Hello",direction:"in",sentAt:"2026-10-22T10:00:00Z"}]}}]);
    assert.ok(stageState.contacts.some(c=>c.name==="Manual"));assert.ok(stageState.contacts.some(c=>c.name==="Imported"));assert.ok(stageState.contacts.some(c=>c.name==="Synced"));
    assert.ok(stageState.contacts.some(c=>c.phone==="+12025550106"));assert.equal(stageState.contacts.some(c=>c.stage==="new"||c.stage==="gone"),false);
  }finally{ui.close();}
});

test("new contacts keep the New customer default when it is reordered, and use the first stage when it is removed",()=>{
  assert.equal(mod.resolveActiveSalesStage(undefined,["won","new"]),"new");assert.equal(mod.resolveActiveSalesStage("new",["custom","won"]),"custom");assert.equal(mod.resolveActiveSalesStage("won",["custom","won"]),"won");
  assert.equal(mod.resolveSalesStageLabel("constructor",{}),"constructor");
});

test("stage creation rechecks the 20-stage limit and the last remaining stage cannot be deleted in the manager",()=>{
  const ui=fixture();try {
    let tree=ui.render();byLabel(tree,"添加阶段").props.onChange({target:{value:"Extra"}});tree=ui.render();
    stageState.settings.salesStageOrder=Array.from({length:20},(_,i)=>"stage_"+i);
    nodes(tree).find(n=>n.type==="form").props.onSubmit({preventDefault(){}});
    assert.equal(stageState.settings.salesStageOrder.length,20);assert.equal(ui.toasts.at(-1)[0],"最多保留 20 个销售阶段");
    stageState.settings.salesStageOrder=["won"];tree=ui.render();assert.equal(byLabel(tree,"删除阶段 · 成交").props.disabled,true);
  }finally{ui.close();}
});

test("manager focuses the requested stage, retains keyboard focus on edit save or cancel, and restores its trigger on close",()=>{
  const ui=fixture(),previousDocument=globalThis.document,previousElement=globalThis.HTMLElement;
  class Control {isConnected=true;value="Draft";focus(){document.activeElement=this;}blur(){document.activeElement=null;}getClientRects(){return [{}];}}
  globalThis.HTMLElement=Control;const trigger=new Control(),close=new Control(),input=new Control(),last=new Control();globalThis.document={activeElement:trigger};
  try {
    const tree=ui.render(mod.SalesStageManager,{onClose(){},focusStageId:"new"});
    byLabel(tree,"关闭").props.ref.current=close;const stageInput=byLabel(tree,"阶段名称 · 新客户");stageInput.props.ref.current=input;
    ui.effects.splice(0).forEach(fn=>fn());assert.equal(document.activeElement,input);
    stageInput.props.onKeyDown({key:"Enter",currentTarget:input,preventDefault(){}});assert.equal(document.activeElement,close);
    input.focus();stageInput.props.onKeyDown({key:"Escape",currentTarget:input,preventDefault(){},stopPropagation(){}});assert.equal(input.value,"新客户");assert.equal(document.activeElement,close);
    const dialog=nodes(tree).find(n=>n.props.role==="dialog");
    const event=(shiftKey)=>({key:"Tab",shiftKey,currentTarget:{querySelectorAll:()=>[close,last]},preventDefault(){}});
    dialog.props.onKeyDown(event(true));assert.equal(document.activeElement,last);dialog.props.onKeyDown(event(false));assert.equal(document.activeElement,close);
    ui.close();assert.equal(document.activeElement,trigger);
  }finally{ui.close();globalThis.document=previousDocument;globalThis.HTMLElement=previousElement;}
});
