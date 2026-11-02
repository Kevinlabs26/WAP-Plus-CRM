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
const item = {title:'Invitation',category:'Events',caption:'On commence déjà la réunion ? 🎉\nRejoins-nous !',data,pinned:true,usedAt:10};
const backup = items => ({app:'WAP Plus CRM Image Library',version:1,items});

test('empty custom categories round trip in backups and invalid categories never start restoration', async () => {
  const calls=[];globalThis.libraryInvoke=async(cmd,{request})=>{calls.push(request);};
  try {
    await api.exportImageLibrary([],['我的分类']);
    assert.deepEqual(globalThis.libraryDownload.categories,['我的分类']);
    const file=value=>new File([JSON.stringify(value)],'library.json');
    assert.equal(await api.restoreImageLibrary(file(globalThis.libraryDownload),()=>{}),0);
    assert.deepEqual(calls,[{action:'createCategory',name:'我的分类'}]);
    calls.length=0;
    await assert.rejects(api.restoreImageLibrary(file({...backup([]),categories:['Valid','*']}),()=>{}));
    assert.equal(calls.length,0);
  } finally {delete globalThis.libraryInvoke;}
});

test('backup validation rejects remote URLs, SVG, malformed or excessive entries before import', () => {
  assert.deepEqual(api.parseImageLibraryBackup(backup([item])),[item]);
  const {caption,...legacy}=item;
  assert.equal(api.parseImageLibraryBackup(backup([legacy]))[0].caption,'');
  for(const caption of [null,123,{},'x'.repeat(2001),'🎉'.repeat(1001)]) assert.throws(()=>api.parseImageLibraryBackup(backup([{...item,caption}])));
  for(const bad of [null,{},backup([{...item,data:'https://example.invalid/a.png'}]),backup([{...item,data:'data:image/svg+xml;base64,PHN2Zz4='}]),backup([{...item,category:'x'.repeat(61)}]),backup(new Array(3001).fill(item))]) assert.throws(()=>api.parseImageLibraryBackup(bad));
  assert.equal(api.parseImageLibraryBackup(backup([{...item,usedAt:Infinity}]))[0].usedAt,0);
});

test('caption edits validate before IPC and distinguish clearing from an omitted field',async()=>{
  const calls=[];globalThis.libraryInvoke=async(cmd,{request})=>{calls.push(request);};
  try {
    for(const caption of [null,123,'x'.repeat(2001)]) await assert.rejects(api.editLibraryImage({...item,id:'a'.repeat(64),caption}));
    assert.equal(calls.length,0);
    await api.editLibraryImage({...item,id:'a'.repeat(64)});
    await api.editLibraryImage({...item,id:'a'.repeat(64),caption:''});
    const {caption,...legacy}=item;await api.editLibraryImage({...legacy,id:'a'.repeat(64)});
    assert.deepEqual(calls.map(call=>call.caption),[item.caption,'',undefined]);
  } finally {delete globalThis.libraryInvoke;}
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
    assert.equal(calls.find(c=>c.action==='edit').caption,item.caption);
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
  'lucide-react':'export const ImagePlus="image-plus",Plus="plus",Star="star",CheckSquare="check-square",ListChecks="list-checks",X="x";',
  '@/components/ui/primitives':'export const Button="button";',
  '@/i18n':'export const useI18n=()=>({t:(key)=>key});',
  '@/store/appStore':'export const useAppStore=f=>f(globalThis.libraryState);useAppStore.getState=()=>globalThis.libraryState;',
  '@/lib/bridge':'export const isTauri=()=>true;',
  '@tauri-apps/api/core':'export const invoke=async()=>{};',
  '@/lib/quickReplyMedia':'export const emitQuickReplyMedia=value=>{globalThis.libraryEmitted.push(value);return true;};',
  '@/lib/imageLibrary':'export const listLibraryImages=async()=>globalThis.libraryRows;export const listLibraryCategories=async()=>globalThis.libraryCategories||[];export const deleteLibraryCategory=async name=>globalThis.libraryDeleteCategory?.(name);export const createLibraryCategory=async name=>{globalThis.libraryCategories=[...(globalThis.libraryCategories||[]),name];};export const filterLibraryImages=(...a)=>globalThis.libraryFilter(...a);export const readLibraryImage=id=>globalThis.libraryRead(id);export const editLibraryImage=async image=>globalThis.libraryEdit?.(image);export const addLibraryImage=async(file,category)=>{globalThis.libraryImportCategory=category;return {added:true};};export const deleteLibraryImages=async()=>{};export const exportImageLibrary=async()=>{};export const restoreImageLibrary=async()=>0;',
};
const uiBuild=await build({entryPoints:[root+'src/components/chat/ImageLibraryPanel.tsx'],bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',plugins:[{name:'gallery-ui',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {ImageLibraryPanel}=await import('data:text/javascript;base64,'+Buffer.from(uiBuild.outputFiles[0].text).toString('base64'));
const allNodes=tree=>Array.isArray(tree)?tree.flatMap(allNodes):tree?.props?[tree,...allNodes(tree.props.children)]:[];
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('saved image captions reopen, insert by default, clear, and remain editable after a failed save',async()=>{
  const original=globalThis.window;globalThis.window=new EventTarget();
  globalThis.libraryFilter=api.filterLibraryImages;
  globalThis.libraryRows=[{...item,id:'photo',mime:'image/png',size:20,thumbnail:data,createdAt:1}];
  globalThis.libraryRead=async()=>data;
  globalThis.libraryState={selectedChatId:'chat',pushToast(){}};
  globalThis.libraryEmitted=[];
  const edits=[];let fail=false;
  globalThis.libraryEdit=async image=>{if(fail)throw new Error('disk full');edits.push(image);globalThis.libraryRows=[image];};
  function mount(component,props) {
    const slots=[];let cursor=0,effects=[];
    return {
      render(next=props){props=next;cursor=0;effects=[];globalThis.libraryHooks={
        state(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},
        ref(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},
        effect(work,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>v!==old.deps[j]))effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:work()};});},
      };const nodes=allNodes(component(props));effects.forEach(f=>f());return nodes;},
      close(){slots.forEach(slot=>slot?.cleanup?.());},
    };
  }
  const panel=mount(ImageLibraryPanel,{chatId:'chat',contextKey:'chat:a'});
  let preview;
  const open=()=>{
    panel.render().find(n=>n.props['aria-label']==='quickShelf.previewNamed').props.onClick();
    return panel.render().find(n=>typeof n.type==='function'&&n.props.image);
  };
  try {
    panel.render();await settle();
    panel.render().find(n=>n.props['aria-label']==='quickShelf.insert').props.onClick();await settle();await settle();
    assert.equal(globalThis.libraryEmitted[0].caption,item.caption);
    const dialog=open();preview=mount(dialog.type,dialog.props);
    let nodes=preview.render();await settle();nodes=preview.render();
    assert.equal(nodes.find(n=>n.type==='textarea').props.value,item.caption);
    nodes.find(n=>n.type==='textarea').props.onChange({target:{value:'Nouvelle invitation 🎉\nCe soir !'}});
    preview.render().find(n=>n.props.children==='gallery.saveInsert').props.onClick();await settle();await settle();
    assert.equal(edits.at(-1).caption,'Nouvelle invitation 🎉\nCe soir !');
    assert.equal(globalThis.libraryEmitted.at(-1).caption,'Nouvelle invitation 🎉\nCe soir !');
    preview.close();const reopened=open();preview=mount(reopened.type,reopened.props);
    nodes=preview.render();await settle();nodes=preview.render();
    assert.equal(nodes.find(n=>n.type==='textarea').props.value,'Nouvelle invitation 🎉\nCe soir !');
    nodes.find(n=>n.type==='textarea').props.onChange({target:{value:''}});
    fail=true;const before=globalThis.libraryEmitted.length;
    preview.render().find(n=>n.props.children==='gallery.saveInsert').props.onClick();await settle();await settle();
    assert.equal(globalThis.libraryEmitted.length,before);
    const failed=panel.render().find(n=>typeof n.type==='function'&&n.props.image);
    assert.match(failed.props.saveError,/disk full/);
    assert.ok(preview.render(failed.props).some(n=>n.props.role==='alert'&&/disk full/.test(n.props.children)));
    assert.equal(preview.render().find(n=>n.type==='textarea').props.value,'');
    fail=false;preview.render().find(n=>n.props.children==='common.save').props.onClick();await settle();await settle();
    assert.equal(globalThis.libraryRows[0].caption,'');
    assert.equal(globalThis.libraryEmitted.length,before);
    panel.render().find(n=>n.props['aria-label']==='quickShelf.insert').props.onClick();await settle();await settle();
    assert.equal(globalThis.libraryEmitted.at(-1).caption,'');
  } finally {preview?.close();panel.close();globalThis.window=original;delete globalThis.libraryEdit;}
});

test('gallery paginates, orders insertion, blocks account changes and deletes categories only after confirmation',async()=>{
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
    assert.equal(nodes.filter(n=>n.type==='input'&&n.props.type==='checkbox').length,0);
    assert.equal(nodes.some(n=>n.type==='form'),false);
    nodes.find(n=>n.props.children==='gallery.multiSelect').props.onClick();render();
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
    allNodes(tree).find(n=>n.type==='input'&&n.props['aria-label']==='gallery.categoryName').props.onChange({target:{value:'我的自定义分类'}});
    render();allNodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
    await settle();await settle();render();
    assert.ok(allNodes(tree).some(n=>n.type==='button'&&n.props.title==='我的自定义分类'&&n.props['aria-pressed']));
    assert.equal(allNodes(tree).filter(n=>n.type==='article').length,0);
    allNodes(tree).find(n=>n.type==='input'&&n.props.type==='file'&&n.props.multiple).props.onChange({currentTarget:{files:[new File(['image'],'photo.png',{type:'image/png'})],value:'file'}});
    await settle();await settle();render();assert.equal(globalThis.libraryImportCategory,'我的自定义分类');
    let confirm=false,fail=false;const deleted=[];
    globalThis.libraryState.requestConfirm=async options=>{assert.equal(options.description,'gallery.deleteCategoryHint');return confirm;};
    globalThis.libraryDeleteCategory=async name=>{
      if(fail)throw new Error('database busy');
      deleted.push(name);globalThis.libraryCategories=(globalThis.libraryCategories||[]).filter(value=>value!==name);
      globalThis.libraryRows=globalThis.libraryRows.map(image=>image.category===name?{...image,category:''}:image);
    };
    const categoryNode=name=>allNodes(tree).find(n=>n.type==='button'&&n.props.title===name);
    render();
    categoryNode('我的自定义分类').props.onContextMenu({preventDefault(){}});await settle();await settle();render();
    assert.equal(deleted.length,0);assert.ok(categoryNode('我的自定义分类'));
    confirm=true;fail=true;
    allNodes(tree).find(n=>n.props.children==='gallery.deleteCategory').props.onClick();await settle();await settle();render();
    assert.equal(deleted.length,0);assert.ok(categoryNode('我的自定义分类'));
    assert.ok(allNodes(tree).some(n=>n.props.role==='alert'&&/database busy/.test(n.props.children)));
    fail=false;
    allNodes(tree).find(n=>n.props.children==='gallery.deleteCategory').props.onClick();await settle();await settle();render();
    assert.deepEqual(deleted,['我的自定义分类']);assert.equal(categoryNode('我的自定义分类'),undefined);
    assert.equal(allNodes(tree).some(n=>n.props.children==='gallery.deleteCategory'),false);
    categoryNode('Events').props.onContextMenu({preventDefault(){}});await settle();await settle();render();
    assert.deepEqual(deleted,['我的自定义分类','Events']);assert.equal(categoryNode('Events'),undefined);
    assert.ok(categoryNode('gallery.uncategorized'));
    assert.equal(categoryNode('multi.all').props.onContextMenu,undefined);
    assert.equal(categoryNode('gallery.uncategorized').props.onContextMenu,undefined);
    assert.equal(globalThis.libraryRows.length,1000);
    assert.ok(globalThis.libraryRows.every(image=>image.category===''));
  } finally {slots.forEach(slot=>slot?.cleanup?.());globalThis.window=original;delete globalThis.libraryDeleteCategory;}
});
