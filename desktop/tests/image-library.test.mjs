import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build, transform } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const bundled = await build({ entryPoints: [root + 'src/lib/imageLibrary.ts'], bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'library-services', setup(b) {
  b.onResolve({filter:/^@tauri-apps\/api\/core$/}, () => ({path:'ipc',namespace:'mock'}));
  b.onResolve({filter:/^\.\/exportData$/}, () => ({path:'download',namespace:'mock'}));
  b.onLoad({filter:/.*/,namespace:'mock'}, a => ({contents:a.path==='ipc' ? 'export const invoke=(cmd,args)=>globalThis.libraryInvoke(cmd,args);' : 'export const downloadJson=(name,value)=>{globalThis.libraryDownload=value;};'}));
} }] });
const api = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const data = 'data:image/png;base64,' + Buffer.from('\x89PNG\r\n\x1a\nfixture','latin1').toString('base64');
const item = {title:'Invitation',category:'Events',data,pinned:true,usedAt:10};
const backup = items => ({app:'WAP Plus CRM Image Library',version:1,items});

test('backup validation rejects remote URLs, SVG, malformed or excessive entries before import', () => {
  assert.deepEqual(api.parseImageLibraryBackup(backup([item])),[item]);
  for(const bad of [null,{},backup([{...item,data:'https://example.invalid/a.png'}]),backup([{...item,data:'data:image/svg+xml;base64,PHN2Zz4='}]),backup([{...item,category:'x'.repeat(61)}]),backup(new Array(3001).fill(item))]) assert.throws(()=>api.parseImageLibraryBackup(bad));
  assert.equal(api.parseImageLibraryBackup(backup([{...item,usedAt:Infinity}]))[0].usedAt,0);
});

test('category/search/favorite/recent filters preserve source rows and sort correctly for 1000 images', () => {
  const rows=Array.from({length:1000},(_,i)=>({id:String(i),title:i===900?'Grâce invitation':'Photo '+i,category:i%2?'Events':'Other',pinned:i===900,createdAt:i,usedAt:i===8?100:0}));
  assert.equal(api.filterLibraryImages(rows,'grace invitation','*','all')[0].id,'900');
  assert.equal(api.filterLibraryImages(rows,'','*','pinned').length,1);
  assert.equal(api.filterLibraryImages(rows,'','*','recent')[0].id,'8');
  assert.equal(api.filterLibraryImages(rows,'','Events','all').length,500);
  assert.equal(rows[0].id,'0');
});

test('export includes original image data; merge restore preserves duplicate metadata and restores favorites', async () => {
  const old={FileReader:globalThis.FileReader,Image:globalThis.Image,document:globalThis.document};
  const calls=[];
  globalThis.FileReader=class {readAsDataURL(file){file.arrayBuffer().then(buffer=>{this.result=`data:${file.type};base64,${Buffer.from(buffer).toString('base64')}`;this.onload();});}};
  globalThis.Image=class {naturalWidth=320;naturalHeight=200;set src(value){queueMicrotask(()=>this.onload());}};
  globalThis.document={createElement:()=>({getContext:()=>({fillRect(){},drawImage(){}}),toDataURL:()=> 'data:image/jpeg;base64,/9j/AA=='})};
  let added=true;
  globalThis.libraryInvoke=async(cmd,{request})=>{calls.push(request);if(request.action==='read')return data;if(request.action==='import')return {id:'a'.repeat(64),added};};
  try {
    await api.exportImageLibrary([{...item,id:'a'.repeat(64),size:20,mime:'image/png'}]);
    assert.deepEqual(globalThis.libraryDownload.items,[item]);
    const makeFile=()=>new File([JSON.stringify(globalThis.libraryDownload)],'library.json',{type:'application/json'});
    assert.equal(await api.restoreImageLibrary(makeFile(),()=>{}),1);
    assert.equal(calls.find(c=>c.action==='edit').pinned,true);
    assert.equal(calls.find(c=>c.action==='edit').used_at,10);
    calls.length=0;added=false;
    assert.equal(await api.restoreImageLibrary(makeFile(),()=>{}),0);
    assert.equal(calls.some(c=>c.action==='edit'||c.action==='delete'),false);
    calls.length=0;
    await assert.rejects(api.restoreImageLibrary(new File([JSON.stringify(backup([item,{...item,data:'bad'}]))],'bad.json'),()=>{}));
    assert.equal(calls.length,0);
  } finally {Object.assign(globalThis,old);delete globalThis.libraryInvoke;}
});

const composer=readFileSync(root+'src/components/chat/Composer.tsx','utf8');
const start=composer.indexOf('    return onQuickReplyMedia((selection) => {');
const end=composer.indexOf('\n    });',start)+8;
assert.ok(start>0&&end>start);
const handler=(await transform(composer.slice(start,end),{loader:'ts',target:'es2022'})).code;
const makeComposer=new Function('options',`
  let callback;const writes=[],staged=[];
  const onQuickReplyMedia=fn=>{callback=fn;};
  const resetKey='chat',sending=false,recording=false,inputLocked=false,editingId=null,mediaSendingIndex=-1;
  const pendingMedia=Array.from({length:options.pending||0});
  const quickReplyMediaToFile=selection=>selection.dataUrl==='bad'?null:{name:selection.fileName};
  const readDraft=()=> 'existing';const setDraftLocal=value=>writes.push(value),flushDraftNow=()=>{},setMediaCaption=()=>{};
  const stageMediaRef={current:files=>staged.push(files)};
  function connect(){${handler}}connect();return {callback,writes,staged};
`);

test('gallery stages multiple images atomically in selection order and rejects full/wrong chat without changing drafts',()=>{
  const selection={chatId:'chat',target:'main',token:'t',dataUrl:data,fileName:'second',additionalMedia:[{dataUrl:data,fileName:'first'}],caption:'caption'};
  const ui=makeComposer({});assert.equal(ui.callback(selection),true);
  assert.deepEqual(ui.staged[0].map(file=>file.name),['second','first']);
  assert.equal(ui.writes[0],'existing\ncaption');
  for(const [options,value] of [[{pending:4},selection],[{}, {...selection,chatId:'other'}],[{}, {...selection,additionalMedia:[{dataUrl:'bad'}]}]]){
    const blocked=makeComposer(options);assert.notEqual(blocked.callback(value),true);assert.equal(blocked.staged.length,0);assert.equal(blocked.writes.length,0);
  }
});

const mocks={
  react:'export const useState=i=>globalThis.libraryHooks.state(i);export const useRef=i=>globalThis.libraryHooks.ref(i);export const useMemo=f=>f();export const useEffect=(f,d)=>globalThis.libraryHooks.effect(f,d);',
  'react/jsx-runtime':'export const Fragment="fragment";export const jsx=(type,props)=>({type,props});export const jsxs=jsx;',
  'lucide-react':'export const ImagePlus="image-plus",Star="star";',
  '@/components/ui/primitives':'export const Button="button";',
  '@/i18n':'export const useI18n=()=>({t:(key)=>key});',
  '@/store/appStore':'export const useAppStore=f=>f(globalThis.libraryState);useAppStore.getState=()=>globalThis.libraryState;',
  '@/lib/bridge':'export const isTauri=()=>true;',
  '@tauri-apps/api/core':'export const invoke=async()=>{};',
  '@/lib/quickReplyMedia':'export const emitQuickReplyMedia=value=>{globalThis.libraryEmitted.push(value);return true;};',
  '@/lib/imageLibrary':'export const listLibraryImages=async()=>globalThis.libraryRows;export const filterLibraryImages=(...a)=>globalThis.libraryFilter(...a);export const readLibraryImage=id=>globalThis.libraryRead(id);export const editLibraryImage=async()=>{};export const addLibraryImage=async()=>({added:true});export const deleteLibraryImages=async()=>{};export const exportImageLibrary=async()=>{};export const restoreImageLibrary=async()=>0;',
};
const uiBuild=await build({entryPoints:[root+'src/components/chat/ImageLibraryPanel.tsx'],bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',plugins:[{name:'gallery-ui',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {ImageLibraryPanel}=await import('data:text/javascript;base64,'+Buffer.from(uiBuild.outputFiles[0].text).toString('base64'));
const allNodes=tree=>Array.isArray(tree)?tree.flatMap(allNodes):tree?.props?[tree,...allNodes(tree.props.children)]:[];
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('gallery renders only one page, preserves selection order and blocks insertion after account change',async()=>{
  const original=globalThis.window;globalThis.window=new EventTarget();
  globalThis.libraryFilter=api.filterLibraryImages;
  globalThis.libraryRows=Array.from({length:1000},(_,i)=>({id:String(i),title:'Photo '+i,category:'Events',mime:'image/png',size:20,thumbnail:data,pinned:false,usedAt:0,createdAt:1000-i}));
  globalThis.libraryState={selectedChatId:'chat',pushToast(){},requestConfirm:async()=>true};
  globalThis.libraryEmitted=[];
  let slots=[],cursor=0,effects=[],tree,props={chatId:'chat',contextKey:'chat:account-a'};
  const render=()=>{
    cursor=0;effects=[];
    globalThis.libraryHooks={
      state(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return [slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];},
      ref(initial){const index=cursor++;return slots[index]??(slots[index]={current:initial});},
      effect(work,deps){const index=cursor++,old=slots[index];if(!old||deps.some((value,i)=>value!==old.deps[i]))effects.push(()=>{old?.cleanup?.();slots[index]={deps,cleanup:work()};});},
    };
    tree=ImageLibraryPanel(props);effects.forEach(effect=>effect());return allNodes(tree);
  };
  const select=id=>{const nodes=allNodes(tree);nodes.filter(n=>n.type==='input'&&n.props.type==='checkbox')[id].props.onChange({target:{checked:true}});render();};
  try {
    render();await settle();let nodes=render();assert.equal(nodes.filter(n=>n.type==='article').length,40);
    select(5);select(2);
    const reads=[];globalThis.libraryRead=async id=>{reads.push(id);return data;};
    allNodes(tree).find(n=>n.props.children==='gallery.insertSelected').props.onClick();await settle();await settle();render();
    assert.deepEqual(reads,['5','2']);assert.equal(globalThis.libraryEmitted.length,1);
    assert.equal(globalThis.libraryEmitted[0].fileName,'Photo 5.png');assert.equal(globalThis.libraryEmitted[0].additionalMedia[0].fileName,'Photo 2.png');
    select(0);let release;globalThis.libraryRead=()=>new Promise(resolve=>{release=resolve;});
    allNodes(tree).find(n=>n.props.children==='gallery.insertSelected').props.onClick();
    props={...props,contextKey:'chat:account-b'};render();release(data);await settle();await settle();render();
    assert.equal(globalThis.libraryEmitted.length,1);
    assert.ok(allNodes(tree).some(n=>n.props.children==='Error: gallery.chatChanged'));
  } finally {slots.forEach(slot=>slot?.cleanup?.());globalThis.window=original;}
});
