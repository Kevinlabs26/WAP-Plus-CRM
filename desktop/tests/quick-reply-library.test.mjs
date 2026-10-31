import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { parseQuickReplyTable } from '../src/lib/quickReplyImport.ts';

test('spreadsheet replies preserve quoted multiline bodies and detect actual separators', () => {
  assert.deepEqual(parseQuickReplyTable('\uFEFF标题\t内容\t分类\r\n回笼\t"Bonjour, ma sœur;\nPaix ""à toi"""\t开场').rows,
    [{title:'回笼',body:'Bonjour, ma sœur;\nPaix "à toi"',category:'开场'}]);
  assert.equal(parseQuickReplyTable('Titre;Contenu;Catégorie\nA;"Bonjour, ça va, mon amie";Accueil').rows[0].body, 'Bonjour, ça va, mon amie');
  assert.equal(parseQuickReplyTable('A,"Bonjour; ça va; mon amie",Accueil').rows[0].category, 'Accueil');
  assert.deepEqual(parseQuickReplyTable('A\t=SUM(1,2)').rows, [{title:'A',body:'=SUM(1,2)',category:''}]);
});
test('import rejects malformed and overlong rows instead of silently truncating', () => {
  assert.deepEqual(parseQuickReplyTable('A\t\nB\tOK\n'+ 'x'.repeat(41)+'\tBody').invalidRows,[1,3]);
  assert.throws(()=>parseQuickReplyTable('A\t"unclosed'));
  assert.throws(()=>parseQuickReplyTable('A\tB\n'.repeat(1002)));
  assert.throws(()=>parseQuickReplyTable('A\tB\n'.repeat(1001)));
  assert.equal(parseQuickReplyTable('Title\tBody\n'+'A\tB\n'.repeat(1000)).rows.length,1000);
  assert.throws(()=>parseQuickReplyTable('x'.repeat(3_000_001)));
});

const mocks = {
  react: 'export const useState=i=>globalThis.quickHooks.state(i);export const useRef=i=>globalThis.quickHooks.ref(i);export const useMemo=f=>f();export const useEffect=(f,d)=>globalThis.quickHooks.effect(f,d);',
  'react/jsx-runtime': 'export const Fragment="fragment";export const jsx=(type,props)=>({type,props});export const jsxs=jsx;',
  '@/i18n': 'export const useI18n=()=>({t:(key,params)=>key+(params?JSON.stringify(params):"" )});',
  '@/components/ui/primitives': 'export const Button="button",Input="input",Textarea="textarea",SectionLabel="section-label";',
  '@/store/appStore': 'export const useAppStore=fn=>fn(globalThis.quickState);useAppStore.getState=()=>globalThis.quickState;',
  '@/lib/accountConnection': 'export const isWaAccountConnected=()=>globalThis.quickState.connected;',
  '@/lib/baileys': 'export const baileysRemoveQuickReply=async()=>{await globalThis.quickState.removeRemote?.();};export const baileysSyncQuickReplies=async items=>{globalThis.quickState.synced=items;return {synced:items.length};};',
};
const result = await build({entryPoints:[fileURLToPath(new URL('../src/components/settings/SettingsQuickRepliesPanel.tsx',import.meta.url))],
 bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',alias:{'@':fileURLToPath(new URL('../src',import.meta.url))},
 plugins:[{name:'quick-reply-boundaries',setup(b){
 b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));
 }}]});
const {SettingsQuickRepliesPanel}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text+'\n//# sourceURL=quick-replies-panel.test-bundle.js').toString('base64'));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree?.props?[tree,...nodes(tree.props.children)]:[];
const reply=(id,extra={})=>({id,title:id,body:'Body '+id,category:'other',...extra});
const media={dataUrl:'data:image/png;base64,AA==',fileName:'photo.png',mimeType:'image/png',kind:'image',size:1};
function harness(replies=[reply('a')]) {
 let slots=[],cursor=0,tree,effects=[],cleanups=[],timers=[];
 const state={settings:{quickReplies:replies,quickReplyCustomCategories:[]},baileysUi:{connection:'close'},connected:false,toasts:[],
 updateSettings(patch){state.settings={...state.settings,...patch};},pushToast(...args){state.toasts.push(args);}};
 globalThis.quickState=state;
 globalThis.quickHooks={
 state(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},
 ref(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},
 effect(fn,deps){const i=cursor++;if(!slots[i]||deps.some((d,j)=>!Object.is(d,slots[i][j]))){slots[i]=deps;effects.push(fn);}}
 };
 const originalTimeout=globalThis.setTimeout;
 globalThis.setTimeout=(fn,ms,...args)=>{const timer=originalTimeout(fn,ms,...args);timer.unref();timers.push(timer);return timer;};
 const h={state,nodes:()=>nodes(tree),render(){for(let pass=0;pass<3;pass++){cursor=0;tree=SettingsQuickRepliesPanel();const pending=effects;effects=[];if(!pending.length)break;for(const f of pending){const cleanup=f();if(cleanup)cleanups.push(cleanup);}}return tree;},
 find(label){return h.nodes().find(n=>n.props['aria-label']===label||n.props.children===label);},
 click(label){const n=h.find(label);assert.ok(n,'missing '+label);assert.ok(!n.props.disabled,'disabled '+label);const p=n.props.onClick();h.render();return p;},
    type(label,value){h.nodes().find(n=>n.props['aria-label']===label&&n.props.onChange).props.onChange({target:{value}});h.render();},
 check(label,checked=true){h.find(label).props.onChange({target:{checked}});h.render();},
 upload(file){h.nodes().find(n=>n.props.type==='file').props.onChange({target:{files:[file]},currentTarget:{value:'file'}});h.render();},
 close(){for(const f of cleanups)f();for(const timer of timers)clearTimeout(timer);globalThis.setTimeout=originalTimeout;}
 };
 h.render();return h;
}

test('1000 replies render at most 50 list entries and one editor; bulk changes only selected entries',()=>{
 const h=harness(Array.from({length:1000},(_,i)=>reply('r'+i)));
 try {
 assert.equal(h.nodes().filter(n=>n.props.type==='checkbox').length,51);
 assert.equal(h.nodes().filter(n=>n.type==='textarea').length,1);
 h.check('quickLibrary.selectReply'+JSON.stringify({title:'r0'}));
 h.type('quickLibrary.moveTo','opening');h.click('quickLibrary.move');
 assert.equal(h.state.settings.quickReplies[0].category,'opening');
 assert.equal(h.state.settings.quickReplies[1].category,'other');
 assert.equal(h.state.settings.quickReplies.length,1000);
 }finally{h.close();}
});

test('media copy preserves attachment and uploading preserves edits made during read',async()=>{
 const h=harness([reply('a',{media})]);const original=globalThis.FileReader;let readers=[];
 globalThis.FileReader=class{constructor(){readers.push(this);}readAsDataURL(){} };
 try{
 h.click('settingsQuickReplies.duplicate');assert.deepEqual(h.state.settings.quickReplies[1].media,media);
 h.upload({name:'new.mp3',type:'audio/mpeg',size:12});
 h.type('settingsQuickReplies.content','Edited while reading');
 readers[0].result='data:audio/mpeg;base64,AA==';readers[0].onload();await Promise.resolve();h.render();
 assert.equal(h.state.settings.quickReplies[1].body,'Edited while reading');
 assert.equal(h.state.settings.quickReplies[1].media.kind,'audio');
 assert.ok(h.nodes().some(n=>n.type==='audio'));
 }finally{h.close();globalThis.FileReader=original;}
});

test('last attachment selection wins and deletion during read cannot recreate a reply',async()=>{
 const h=harness();const original=globalThis.FileReader;let readers=[];
 globalThis.FileReader=class{constructor(){readers.push(this);}readAsDataURL(){} };
 try{
 h.upload({name:'first.pdf',type:'application/pdf',size:1});h.upload({name:'second.png',type:'image/png',size:1});
 readers[1].result=media.dataUrl;readers[1].onload();await Promise.resolve();
 readers[0].result='data:application/pdf;base64,AA==';readers[0].onload();await Promise.resolve();h.render();
 assert.equal(h.state.settings.quickReplies[0].media.fileName,'second.png');
 h.upload({name:'late.png',type:'image/png',size:1});h.click('common.delete');await h.click('settingsQuickReplies.confirmDelete');
 readers[2].result=media.dataUrl;readers[2].onload();await Promise.resolve();
 assert.deepEqual(h.state.settings.quickReplies,[]);
 }finally{h.close();globalThis.FileReader=original;}
});

test('imports atomically create categories, skip duplicates and respect the 1000 reply bound',()=>{
 const h=harness();try{
 h.click('quickLibrary.import');h.type('quickLibrary.import','Title\tBody\tCategory\nWelcome\tBonjour\tAccueil\nWelcome\tBonjour\tAccueil');
 h.click('quickLibrary.confirmImport');assert.equal(h.state.settings.quickReplies.length,2);
 assert.equal(h.state.settings.quickReplyCustomCategories[0].label,'Accueil');
 assert.equal(h.state.settings.quickReplies[1].category,h.state.settings.quickReplyCustomCategories[0].id);
 h.state.settings.quickReplies=Array.from({length:1000},(_,i)=>reply('r'+i));h.render();
 h.click('quickLibrary.import');h.type('quickLibrary.import','Another\tBody\tNew category');h.click('quickLibrary.confirmImport');
 assert.equal(h.state.settings.quickReplies.length,1000);assert.equal(h.state.settings.quickReplyCustomCategories.length,1);
 }finally{h.close();}
});

test('sync over 40 is explicitly blocked; selected text replies sync without media',async()=>{
 const h=harness(Array.from({length:70},(_,i)=>reply('r'+i,{media})));try{
 h.state.connected=true;h.render();await h.click('settingsQuickReplies.sync');assert.equal(h.state.synced,undefined);
 assert.ok(h.state.toasts.some(([key])=>key==='quickLibrary.syncLimit'));
 h.check('quickLibrary.selectReply'+JSON.stringify({title:'r0'}));await h.click('settingsQuickReplies.sync');
 assert.equal(h.state.synced.length,1);assert.equal(h.state.synced[0].media,undefined);
 }finally{h.close();}
});

test('oversized attachments, full media capacity and read failures preserve the existing reply',async()=>{
 const h=harness([reply('a',{media}),reply('full',{media:{...media,size:64*1024*1024-1}})]);
 const original=globalThis.FileReader;let reads=[];
 globalThis.FileReader=class{constructor(){reads.push(this);}readAsDataURL(){} };
 try{
 h.upload({name:'too-big.mp4',type:'video/mp4',size:8*1024*1024+1});
 assert.equal(reads.length,0);assert.deepEqual(h.state.settings.quickReplies[0].media,media);
 h.upload({name:'over-cap.png',type:'image/png',size:2});
 reads[0].result=media.dataUrl;reads[0].onload();await Promise.resolve();h.render();
 assert.deepEqual(h.state.settings.quickReplies[0].media,media);
 assert.ok(h.state.toasts.some(([key])=>key==='quickLibrary.mediaCapacity'));
 h.upload({name:'broken.png',type:'image/png',size:1});reads[1].onerror();await Promise.resolve();h.render();
 assert.ok(h.state.toasts.some(([key])=>key==='settingsQuickReplies.mediaReadFailed'));
 assert.deepEqual(h.state.settings.quickReplies[0].media,media);
 }finally{h.close();globalThis.FileReader=original;}
});
