import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../src", import.meta.url));
const mocks = {
  react: "export const useState=value=>globalThis.shelfHooks.state(value),useEffect=fn=>globalThis.shelfHooks.effect(fn),useMemo=fn=>fn(),useRef=value=>globalThis.shelfHooks.ref(value);",
  "react-dom": "export const createPortal=x=>x;",
  "react/jsx-runtime": "export const Fragment='fragment',jsx=(type,props)=>({type,props}),jsxs=jsx;",
  "lucide-react": "export const ChevronDown='icon',ChevronLeft='icon',ChevronRight='icon',MoreHorizontal='icon',Pencil='icon',Play='icon',Plus='icon',Send='icon',X='icon';",
  "@/i18n": "export const useI18n=()=>({t:(key,params)=>key+(params?.title?':'+params.title:'')});",
  "@/lib/quickReplyMedia": "export const emitQuickReplyMedia=payload=>{globalThis.shelfFixture.inserted.push(payload);return true;};",
  "@/lib/baileys": "export const baileysRemoveQuickReply=async()=>{};",
  "@/lib/accountConnection": "export const isWaAccountConnected=()=>true;",
  "@/lib/imageLibrary": "export const readLibraryThumbnail=async()=>'';export const listLibraryImages=async()=>globalThis.shelfFixture.images,listLibraryCategories=async()=>['Folder A','Folder B'],addLibraryImage=async()=>{},editLibraryImage=async()=>{},readLibraryImage=async()=>'';",
  "@/lib/bridge": "export const isTauri=()=>true;",
  "@/lib/quickReplySheetSync": "export const cancelQuickReplySheetSync=()=>{},removeQuickReplySheetRow=async()=>{},restoreQuickReplySheetRow=async()=>{},scheduleQuickReplySheetSync=()=>{};",
  "@/lib/googleSheetErrors": "export const sheetErrorHint=()=>'';",
  "@/store/appStore": "export const useAppStore=selector=>selector(globalThis.shelfFixture.store);useAppStore.getState=()=>globalThis.shelfFixture.store;",
  "@/lib/quickMediaLibrary": "export const listQuickMedia=async()=>globalThis.shelfFixture.clips,QUICK_MEDIA_CHANGED='wap:quick-media',readQuickMedia=()=>globalThis.shelfFixture.read(),addQuickMedia=async()=>{},removeQuickMedia=async()=>{},clearQuickMedia=async()=>globalThis.shelfFixture.deletions.push('all'),removeQuickMediaBatch=async ids=>globalThis.shelfFixture.deletions.push(ids);export const quickMediaFileType=file=>file.type;",
  "@/components/ui/primitives": "export const Button='button',Input='input';",
  "./ImageLibraryPanel": "export const ImageLibraryPreview='image-preview';",
  "./QuickReplyBrowser": "export const QuickReplyPreview='reply-preview';",
};
const bundle = await build({
  stdin:{ contents:`export {ComposerQuickShelf} from "./components/chat/ComposerQuickShelf";export {QuickMediaManager} from "./components/chat/QuickMediaManager";`,resolveDir:root },
  bundle:true, write:false, format:"esm", platform:"node", alias:{"@":root,"@shared":fileURLToPath(new URL("../../shared",import.meta.url))}, tsconfigRaw:{compilerOptions:{jsx:"react-jsx"}},
  plugins:[{name:"media-shelf-ui",setup(b){
    b.onResolve({filter:/.*/}, a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:"mock"}:undefined);
    b.onLoad({filter:/.*/,namespace:"mock"}, a=>({contents:mocks[a.path]}));
  }}],
});
const {ComposerQuickShelf,QuickMediaManager}=await import("data:text/javascript;base64,"+Buffer.from(bundle.outputFiles[0].text).toString("base64"));
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree?.props ? [tree,...nodes(tree.props.children)] : [];

function harness(component, props={}) {
  let cursor=0;
  const cells=[], effects=[], cleanups=[];
  const previous={window:globalThis.window,localStorage:globalThis.localStorage};
  globalThis.window=new EventTarget();
  globalThis.localStorage={getItem:()=>null,setItem(){}};
  const clips=[{id:"audio",title:"Voice Meeting",kind:"audio",mime:"audio/ogg"},{id:"video",title:"Demo",kind:"video",mime:"video/mp4"}];
  const images=[{id:"a",title:"First",category:"Folder A"},{id:"b",title:"Second",category:"Folder B"}];
  const data=globalThis.shelfFixture={images,clips,inserted:[],deletions:[],
    store:{pushToast(){},requestConfirm:async()=>true}};
  globalThis.shelfHooks={
    state(value){const i=cursor++;if(!(i in cells))cells[i]=typeof value==="function"?value():value;return [cells[i],next=>{cells[i]=typeof next==="function"?next(cells[i]):next;}];},
    ref(value){const i=cursor++;return cells[i]??(cells[i]={current:value});},
    effect(fn){const i=cursor++;if(!(i in cells)){cells[i]=true;effects.push(fn);}},
  };
  return { data, render(){cursor=0;const tree=nodes(component(props));for(const effect of effects.splice(0)){const cleanup=effect();if(cleanup)cleanups.push(cleanup);}return tree;},
    close(){for(const cleanup of cleanups)cleanup();Object.assign(globalThis,previous);delete globalThis.shelfFixture;delete globalThis.shelfHooks;} };
}

test("All includes images from each category, and a double click while reading inserts a clip once", async () => {
  const h=harness(ComposerQuickShelf,{tabs:["images"],quickReplies:[],categories:[],chatId:"chat",canSendReply:true});
  let release, reads=0;
  h.data.read=()=>{reads++;return new Promise(resolve=>{release=resolve;});};
  try {
    h.render();await new Promise(setImmediate);
    let tree=h.render();
    for(const title of ["First","Second"]) assert.ok(tree.some(node=>node.props["aria-label"]==="quickShelf.previewNamed:"+title));
    const plus=tree.find(node=>node.props["aria-label"]==="quickMedia.insert:Voice Meeting");
    plus.props.onClick({detail:1});plus.props.onClick({detail:1});
    assert.equal(reads,1);
    assert.equal(h.render().find(node=>node.props["aria-label"]==="quickMedia.insert:Voice Meeting").props.disabled,true);
    release(new File(["audio"],"voice.ogg",{type:"audio/ogg"}));
    await new Promise(setImmediate);
    plus.props.onClick({detail:2});
    assert.equal(reads,1);
    assert.equal(h.data.inserted.length,1);
    assert.equal(h.data.inserted[0].chatId,"chat");
    tree=h.render();
    tree.find(node=>node.props["aria-pressed"]===false && Array.isArray(node.props.children) && node.props.children.includes("Folder B")).props.onClick();
    assert.ok(h.render().some(node=>node.props["aria-label"]==="quickShelf.previewNamed:Second"));
    assert.ok(!h.render().some(node=>node.props["aria-label"]==="quickShelf.previewNamed:First"));
    assert.ok(!h.render().some(node=>node.props["aria-label"]==="quickMedia.insert:Voice Meeting"));
    h.render().find(node=>node.props.children==="quickMedia.all").props.onClick();
    assert.ok(h.render().some(node=>node.props["aria-label"]==="quickShelf.previewNamed:First"));
    assert.ok(h.render().some(node=>node.props["aria-label"]==="quickMedia.insert:Voice Meeting"));
  } finally {h.close();}
});

test("media management can search, select matching results and confirm a bulk delete", async () => {
  const h=harness(QuickMediaManager);
  try {
    h.render();await new Promise(setImmediate);
    h.render().find(node=>node.props["aria-label"]==="quickMedia.search").props.onChange({target:{value:"voice"}});
    let tree=h.render();
    assert.ok(tree.some(node=>node.props.title==="Voice Meeting"));
    assert.ok(!tree.some(node=>node.props.title==="Demo"));
    tree.find(node=>node.props.type==="checkbox").props.onChange();
    tree=h.render();
    tree.find(node=>node.type==="button"&&node.props.children?.[0]==="quickMedia.deleteSelected").props.onClick();
    await new Promise(setImmediate);
    assert.deepEqual(h.data.deletions,[["audio"]]);
    h.render().find(node=>node.type==="button"&&node.props.children==="quickMedia.clearLocal").props.onClick();
    await new Promise(setImmediate);
    assert.deepEqual(h.data.deletions,[["audio"],"all"]);
  } finally {h.close();}
});

test("Android warns before staging oversized media, including shelves saved before sizes were indexed", async () => {
  const h=harness(ComposerQuickShelf,{tabs:["images"],quickReplies:[],categories:[],chatId:"chat",canSendReply:true});
  const bytes=15*1024*1024;
  h.data.clips=[{id:"new",title:"New",kind:"video",size:bytes},{id:"legacy",title:"Legacy",kind:"video"}];
  h.data.store.settings={sendChannel:"android_bridge"};
  const notices=[];
  h.data.store.pushToast=(message)=>notices.push(message);
  let reads=0;
  h.data.read=async()=>{reads++;return {size:bytes};};
  try {
    h.render();await new Promise(setImmediate);
    const insert=title=>h.render().find(node=>node.props["aria-label"]===`quickMedia.insert:${title}`).props.onClick({detail:1});
    insert("New");
    assert.equal(reads,0);
    insert("Legacy");await new Promise(setImmediate);
    assert.equal(reads,1);
    assert.equal(h.data.inserted.length,0);
    assert.deepEqual(notices,["quickMedia.androidFileTooLarge","quickMedia.androidFileTooLarge"]);
  } finally {h.close();}
});

test("quick replies can be resized upward and downward without changing the media shelf", () => {
  const h = harness(ComposerQuickShelf, {
    tabs: ["quick-replies", "images"],
    quickReplies: [{ id: "reply", category: "welcome", body: "Hello" }],
    categories: [{ id: "welcome", label: "Welcome" }],
    chatId: "chat",
    canSendReply: true,
  });
  const handle = () => h.render().find(node => node.props.role === "separator");
  try {
    const grip = handle();
    assert.equal(grip.props["aria-valuenow"], 108);
    grip.props.onPointerDown({ button: 0, pointerId: 1, clientY: 400, currentTarget: { setPointerCapture() {} } });
    grip.props.onPointerMove({ pointerId: 1, clientY: 300 });
    assert.ok(h.render().some(node => node.props.style?.maxHeight === 208));
    assert.ok(h.render().some(node => node.props.children === "quickMedia.all"));
    grip.props.onPointerMove({ pointerId: 1, clientY: 500 });
    assert.equal(handle().props["aria-valuenow"], 72);
    grip.props.onLostPointerCapture({ pointerId: 1 });
    handle().props.onKeyDown({ key: "ArrowUp", preventDefault() {} });
    assert.equal(handle().props["aria-valuenow"], 108);
  } finally { h.close(); }
});

test("the shelf bounds each render and makes every reply and image reachable", async () => {
  const replies = Array.from({ length: 3201 }, (_, id) => ({ id: `reply-${id}`, title: `Reply ${id}`, body: `Message ${id}`, category: "welcome" }));
  const h = harness(ComposerQuickShelf, { tabs: ["quick-replies", "images"], quickReplies: replies,
    categories: [{ id: "welcome", label: "Welcome" }], chatId: "chat", canSendReply: true });
  h.data.images = Array.from({ length: 1001 }, (_, id) => ({ id: `image-${id}`, title: `Image ${id}`, category: "Folder A" }));
  h.data.clips = [];
  try {
    h.render();
    await new Promise(setImmediate);
    for (const [group, prefix, expected, pageSize] of [["crmPanel.quickReplies", "quickShelf.insertNamed:Reply ", 3201, 96], ["quickMedia.title", "quickShelf.previewNamed:Image ", 1001, 24]]) {
      const found = [];
      while (true) {
        const tree = h.render();
        const cards = tree.filter(node => node.props["aria-label"]?.startsWith(prefix));
        assert.ok(cards.length > 0 && cards.length <= pageSize);
        found.push(...cards.map(node => node.props["aria-label"]));
        const controls = tree.find(node => node.props["aria-label"] === group && nodes(node).some(child => child.props["aria-label"] === "quickLibrary.nextPage"));
        const next = nodes(controls).find(node => node.props["aria-label"] === "quickLibrary.nextPage");
        if (next.props.disabled) break;
        next.props.onClick();
      }
      assert.equal(found.length, expected);
      assert.equal(new Set(found).size, expected);
      assert.equal(found.at(-1), `${prefix}${expected - 1}`);
    }
  } finally { h.close(); }
});
