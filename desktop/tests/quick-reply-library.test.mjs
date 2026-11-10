import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { parseQuickReplyTable, quickReplyRowsToTsv, quickReplySheetRows } from '../src/lib/quickReplyImport.ts';
import { flattenQuickReplyCategories, quickReplyCategoryDescendants, quickReplyPreviewText } from '../src/lib/quickReplies.ts';

test('spreadsheet replies preserve quoted multiline bodies and detect actual separators', () => {
  assert.deepEqual(parseQuickReplyTable('\uFEFF标题\t内容\t分类\r\n回笼\t"Bonjour, ma sœur;\nPaix ""à toi"""\t开场').rows,
    [{title:'回笼',body:'Bonjour, ma sœur;\nPaix "à toi"',category:'开场'}]);
  assert.equal(parseQuickReplyTable('Titre;Contenu;Catégorie\nA;"Bonjour, ça va, mon amie";Accueil').rows[0].body, 'Bonjour, ça va, mon amie');
  assert.equal(parseQuickReplyTable('A,"Bonjour; ça va; mon amie",Accueil').rows[0].category, 'Accueil');
  assert.deepEqual(parseQuickReplyTable('A\t=SUM(1,2)').rows, [{title:'A',body:'=SUM(1,2)',category:''}]);
});
test('Google Sheet tabs map original and translation columns into editable bilingual replies',()=>{
 const rows=quickReplySheetRows([
  {name:'Accueil',columns:[['Original','Bonjour','Merci'],['Translation','Bonjour, bienvenue','Merci beaucoup']]},
  {name:'报价',columns:[['需求确认'],['Can you share the model and quantity?']]},
 ],'Workbook');
 assert.deepEqual(parseQuickReplyTable(quickReplyRowsToTsv(rows)).rows,[
  {title:'Bonjour',body:'Bonjour',category:'Accueil',translation:'Bonjour, bienvenue',parent:'Workbook'},
  {title:'Merci',body:'Merci',category:'Accueil',translation:'Merci beaucoup',parent:'Workbook'},
  {title:'需求确认',body:'需求确认',category:'报价',translation:'Can you share the model and quantity?',parent:'Workbook'},
 ]);
 assert.deepEqual(parseQuickReplyTable('标题\t原文\t分类\t译文\nSalut\t你好\t问候\tBonjour').rows,[
  {title:'Salut',body:'你好',category:'问候',translation:'Bonjour'},
 ]);
});
test('Google Sheet rows trim whitespace, skip empty rows and reject overlong content', () => {
 const rows = quickReplySheetRows([
  {
   name: 'TestTab',
   columns: [
    ['', '   ', 'Normal Original'],
    ['', '   ', 'Normal Translation']
   ]
  }
 ], 'Group');
 const parsed = parseQuickReplyTable(quickReplyRowsToTsv(rows));
 assert.equal(parsed.invalidRows.length, 0);
 assert.equal(parsed.rows.length, 1);
 assert.equal(parsed.rows[0].body, 'Normal Original');
 assert.throws(() => quickReplySheetRows([
  { name: 'TestTab', columns: [['x'.repeat(2500)], ['y'.repeat(2500)]] }
 ], 'Group'), /contentTooLong/);
});
test('swapping A/B preserves the selected language and skips the header', () => {
 assert.deepEqual(quickReplySheetRows([{name:'Tab',columns:[['中文原文','你好'],['法语译文','Bonjour']]}], 'Book', {
  originalColumn:1, translationColumn:0, titleSource:'translation'
 }), [['你好','Bonjour','Tab','你好','Book']]);
 assert.equal(quickReplySheetRows([{name:'Tab',columns:[['The original story'],['这不是翻译表头，是完整正文']]}]).length,1);
});
test('category trees flatten in stored order and parent filters include descendants',()=>{
 const categories=[{id:'root',label:'Workbook'},{id:'a',label:'A',parentId:'root'},{id:'nested',label:'Nested',parentId:'a'},{id:'b',label:'B',parentId:'root'}];
 assert.deepEqual(flattenQuickReplyCategories(categories).map(row=>[row.category.id,row.depth,row.hasChildren]),[['root',0,true],['a',1,true],['nested',2,false],['b',1,false]]);
 assert.deepEqual([...quickReplyCategoryDescendants('a',categories)],['a','nested']);
});
test('list previews omit repeated headings and preserve the rest of long replies',()=>{
 assert.equal(quickReplyPreviewText('Greeting','Greeting'),'');
 assert.equal(quickReplyPreviewText('Greeting','Greeting\r\nBonjour'),'Bonjour');
 assert.equal(quickReplyPreviewText('x'.repeat(40),'x'.repeat(40)+' continuation'),'continuation');
 assert.equal(quickReplyPreviewText('Greeting','Different text'),'Different text');
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
 '@/lib/googleSheetApi': 'export const spreadsheetId=value=>value.includes("/d/")?value.split("/d/")[1].split("/")[0]:null;',
 '@/lib/googleSheets': 'export const connectSheets=async()=>{},initializeSheets=async()=>{},readSheet=async(...args)=>globalThis.quickState.readSheet?.(...args)||({sheets:[]}),tabRange=tab=>"\'"+tab+"\'",useGoogleSheets=()=>({ready:true,configured:true,email:globalThis.quickState.email||null,needsAccess:false,busy:false,error:""});',
 '@/lib/quickReplySheetSync': 'export const scheduleQuickReplySheetSync=(id)=>globalThis.quickState.syncIds?.push(id);export const cancelQuickReplySheetSync=()=>{};export const removeQuickReplySheetRow=async(link)=>globalThis.quickState.removeSheetRow?.(link);export const restoreQuickReplySheetRow=async()=>{};',
 '@/lib/googleSheetErrors': 'export const sheetErrorHint=()=>"sheets.error.other";',
  '@/lib/accountConnection': 'export const isWaAccountConnected=()=>globalThis.quickState.connected;',
  '@/lib/baileys': 'export const baileysRemoveQuickReply=async()=>{await globalThis.quickState.removeRemote?.();};export const baileysSyncQuickReplies=async items=>{globalThis.quickState.synced=items;return {synced:items.length};};',
};
const result = await build({stdin:{contents:`export {SettingsQuickRepliesPanel} from './src/components/settings/SettingsQuickRepliesPanel.tsx';export {normalizeLoadedSettings} from './src/store/settingsDefaults.ts';export {buildSettingsSafe,parseBackupJson} from './src/lib/exportData.ts';export {getQuickReplyCategories} from './src/lib/quickReplies.ts';`,resolveDir:fileURLToPath(new URL('../',import.meta.url))},
 bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',alias:{'@':fileURLToPath(new URL('../src',import.meta.url))},
 plugins:[{name:'quick-reply-boundaries',setup(b){
 b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));
 }}]});
const {SettingsQuickRepliesPanel,normalizeLoadedSettings,buildSettingsSafe,parseBackupJson,getQuickReplyCategories}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text+'\n//# sourceURL=quick-replies-panel.test-bundle.js').toString('base64'));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree?.props?[tree,...nodes(tree.props.children)]:[];
const reply=(id,extra={})=>({id,title:id,body:'Body '+id,category:'other',...extra});
const media={dataUrl:'data:image/png;base64,AA==',fileName:'photo.png',mimeType:'image/png',kind:'image',size:1};
function harness(replies=[reply('a')], openEditor=true, props={}) {
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
 const h={state,nodes:()=>nodes(tree),render(){for(let pass=0;pass<3;pass++){cursor=0;tree=SettingsQuickRepliesPanel(props);const pending=effects;effects=[];if(!pending.length)break;for(const f of pending){const cleanup=f();if(cleanup)cleanups.push(cleanup);}}return tree;},
 find(label){const matches=h.nodes().filter(n=>n.props['aria-label']===label||n.props.children===label);return matches.find(n=>n.props.onClick)||matches[0];},
 click(label){const n=h.find(label);assert.ok(n,'missing '+label);assert.ok(!n.props.disabled,'disabled '+label);const p=n.props.onClick();h.render();return p;},
    type(label,value){h.nodes().find(n=>n.props['aria-label']===label&&n.props.onChange).props.onChange({target:{value}});h.render();},
 check(label,checked=true){h.find(label).props.onChange({target:{checked}});h.render();},
 drag(from,to,after=false){
  const source=()=>h.nodes().find(n=>n.props['data-drag-category-id']===from);
  assert.ok(source(),'missing drag source '+from);
  assert.ok(h.nodes().some(n=>n.props['data-category-id']===to),'missing drop target '+to);
  const originalDocument=globalThis.document;
  globalThis.document={elementFromPoint:()=>({closest:()=>({dataset:{categoryId:to},getBoundingClientRect:()=>({top:20,height:20})})})};
  const currentTarget={setPointerCapture(){},hasPointerCapture:()=>true,releasePointerCapture(){},closest:()=>null};
  try{
   source().props.onPointerDown({button:0,pointerId:1,clientX:0,clientY:0,currentTarget});
   source().props.onPointerMove({pointerId:1,clientX:0,clientY:after==='inside'?30:after?39:21,currentTarget,preventDefault(){}});h.render();
   source().props.onPointerUp({pointerId:1,clientX:0,clientY:after==='inside'?30:after?39:21,currentTarget});h.render();
  }finally{globalThis.document=originalDocument;}
 }, upload(file){h.nodes().find(n=>n.props.type==='file').props.onChange({target:{files:[file]},currentTarget:{value:'file'}});h.render();},
 close(){for(const f of cleanups)f();for(const timer of timers)clearTimeout(timer);globalThis.setTimeout=originalTimeout;}
 };
 h.render();
 if(openEditor && replies[0]){h.nodes().find(n=>n.type==='button'&&n.props.children?.[0]?.props?.children===replies[0].title).props.onClick();h.render();}
 return h;
}

test('embedded import opens directly without management and returns the imported categories to the chat shelf',async()=>{
 const imported=[],h=harness([],false,{importOnly:true,defaultCategory:'opening',onImported:ids=>imported.push(ids)});
 try {
  assert.ok(h.find('quickLibrary.sheetUrl'));assert.equal(h.find('settingsQuickReplies.list'),undefined);assert.equal(h.nodes().some(n=>n.type==='nav'),false);
  h.state.email='test@example.com';h.state.readSheet=async(_id,ranges)=>ranges?{valueRanges:[{values:[['Original','Bonjour'],['Translation','你好']]}]}:{properties:{title:'Book'},sheets:[{properties:{title:'Greeting'}}]};
  h.type('quickLibrary.sheetUrl','https://docs.google.com/spreadsheets/d/fixture/edit');
  h.click('quickLibrary.fetchTabs');await new Promise(setImmediate);h.render();
  h.click('quickLibrary.importSelectedTabs'+JSON.stringify({count:1}));await new Promise(setImmediate);h.render();
  const created=h.state.settings.quickReplies[0];assert.equal(created.body,'Bonjour');assert.equal(created.translation,'你好');assert.equal(created.sheetLink.tab,'Greeting');assert.deepEqual(imported,[[created.category]]);
  assert.equal(h.state.settings.quickReplyCustomCategories.find(c=>c.id===created.category).label,'Greeting');
 }finally{h.close();}
});

test('category management is directly reachable in the sidebar and Enter creates a selected custom category',()=>{
 const h=harness([reply('a',{media})]);try{
 const nav=h.nodes().find(n=>n.type==='nav');assert.ok(nodes(nav).some(n=>n.props['aria-controls']==='quick-reply-category-manager'));
 h.click('settingsQuickReplies.manageCategories');h.type('settingsQuickReplies.categoryPlaceholder','  聚会邀请  ');
 h.nodes().find(n=>n.type==='form').props.onSubmit({preventDefault(){}});h.render();
 const category=h.state.settings.quickReplyCustomCategories[0];assert.equal(category.label,'聚会邀请');
 assert.ok(h.nodes().some(n=>n.type==='button'&&n.props['aria-pressed']&&n.props.children[0]?.props?.children==='聚会邀请'));
 assert.deepEqual(h.state.settings.quickReplies,[reply('a',{media})]);
 h.click('settingsQuickReplies.add');assert.equal(h.state.settings.quickReplies[1].category,category.id);
 }finally{h.close();}
});

test('inline editor switches directly between replies and keeps edits without opening dialogs',()=>{
 const h=harness([reply('a',{category:'opening'}),reply('b',{category:'opening'})],false);try{
  const editors=()=>h.nodes().filter(n=>n.type==='section'&&n.props['aria-label']==='quickLibrary.edit');
  const row=id=>h.nodes().find(n=>n.type==='button'&&n.props.children?.[0]?.props?.children===id);
  assert.equal(editors().length,0);
  h.click('quickReply.category.opening');
  row('a').props.onClick();h.render();assert.equal(editors().length,1);
  h.type('settingsQuickReplies.content','Edited inline');
  h.type('settingsQuickReplies.category','quote');
  assert.equal(editors().length,1,'moving the active reply keeps the editor visible until it is collapsed');
  assert.equal(h.state.settings.quickReplies[0].body,'Edited inline');
  row('b').props.onClick();h.render();assert.equal(editors().length,1);
  h.type('settingsQuickReplies.translation','Translation B');
  assert.equal(h.state.settings.quickReplies[1].translation,'Translation B');
  assert.equal(h.nodes().filter(n=>n.type==='dialog').length,0);
  h.click('quickLibrary.collapseEditor');assert.equal(editors().length,0);
  assert.equal(h.state.settings.quickReplies[0].category,'quote');
 }finally{h.close();}
});

test('editing search text does not remove the active reply while typing',()=>{
 const h=harness([reply('a',{body:'Find me'})],false);try{
  h.type('multi.searchQuickReplies','Find me');
  h.nodes().find(n=>n.type==='button'&&n.props.children?.[0]?.props?.children==='a').props.onClick();h.render();
  h.type('settingsQuickReplies.content','New content');
  assert.ok(h.find('settingsQuickReplies.content'));
  h.click('quickLibrary.collapseEditor');
  assert.equal(h.find('settingsQuickReplies.content'),undefined);
  assert.equal(h.state.settings.quickReplies[0].body,'New content');
 }finally{h.close();}
});
test('category separator supports dragging, keyboard resizing and width limits',()=>{
 const h=harness([],false);try{
  const separator=()=>h.nodes().find(n=>n.props.role==='separator');
  separator().props.onPointerDown({preventDefault(){},clientX:100,pointerId:1,currentTarget:{setPointerCapture(){}}});
  separator().props.onPointerMove({clientX:180});h.render();assert.equal(separator().props['aria-valuenow'],300);
  separator().props.onPointerMove({clientX:1000});h.render();assert.equal(separator().props['aria-valuenow'],360);
  separator().props.onLostPointerCapture();
  separator().props.onPointerMove({clientX:0});h.render();assert.equal(separator().props['aria-valuenow'],360);
  separator().props.onKeyDown({key:'ArrowLeft',preventDefault(){}});h.render();assert.equal(separator().props['aria-valuenow'],340);
 }finally{h.close();}
});

test('custom categories can be reordered and moved into a nested hierarchy without cycles',()=>{
 const h=harness([]);try{
 h.state.settings.quickReplyCustomCategories=[{id:'root',label:'Workbook'},{id:'a',label:'A',parentId:'root'},{id:'b',label:'B',parentId:'root'}];h.render();
 h.click('settingsQuickReplies.manageCategories');h.click('quickLibrary.expandCategory'+JSON.stringify({name:'Workbook'}));
 h.drag('b','a');
 assert.deepEqual(getQuickReplyCategories(h.state.settings.quickReplyCustomCategories,[],{},h.state.settings.quickReplyCategoryOrder).filter(item=>item.parentId==='root').map(item=>item.id),['b','a']);
 h.drag('a','b','inside');
 assert.equal(h.state.settings.quickReplyCustomCategories.find(item=>item.id==='a').parentId,'b');
 h.drag('b','a','inside');
 assert.equal(h.state.settings.quickReplyCustomCategories.find(item=>item.id==='b').parentId,'root');
 }finally{h.close();}
});

test('default and custom category names can be edited without losing IDs, content or media',()=>{
 const h=harness([reply('a',{category:'opening',media}),reply('b',{category:'custom-care'})]);try{
 h.state.settings.quickReplyCustomCategories=[{id:'custom-care',label:'Care'}];h.render();h.click('settingsQuickReplies.manageCategories');
 const rename=name=>'settingsQuickReplies.renameCategory'+JSON.stringify({name});
 const blur=(label,value)=>{h.find(label).props.onBlur({currentTarget:{value}});h.render();};
 blur(rename('quickReply.category.opening'),'quickReply.category.opening');assert.equal(h.state.settings.quickReplyCategoryLabels?.opening,undefined,'unchanged defaults keep following the UI language');
 h.type(rename('quickReply.category.opening'),'');
 assert.equal(h.state.settings.quickReplyCategoryLabels?.opening,undefined);assert.equal(h.state.settings.quickReplies[0].category,'opening');
 blur(rename('quickReply.category.opening'),'');assert.equal(h.state.toasts.at(-1)[0],'settingsQuickReplies.categoryInvalid');
 h.type(rename('quickReply.category.opening'),'  日常问候  ');blur(rename('quickReply.category.opening'),'  日常问候  ');
 assert.equal(h.state.settings.quickReplyCategoryLabels.opening,'日常问候');
 h.type(rename('Care'),'关怀');blur(rename('Care'),'关怀');
 assert.equal(h.state.settings.quickReplyCustomCategories[0].id,'custom-care');assert.equal(h.state.settings.quickReplyCustomCategories[0].label,'关怀');
 assert.deepEqual(h.state.settings.quickReplies,[reply('a',{category:'opening',media}),reply('b',{category:'custom-care'})]);
 h.type(rename('关怀'),'日常问候');blur(rename('关怀'),'日常问候');assert.equal(h.state.toasts.at(-1)[0],'settingsQuickReplies.categoryExists');
 assert.equal(h.state.settings.quickReplyCustomCategories[0].label,'关怀');
 h.click('quickLibrary.import');h.type('quickLibrary.import','Added\tHello\t日常问候');h.click('quickLibrary.confirmImport');
 assert.equal(h.state.settings.quickReplies.at(-1).category,'opening');assert.equal(h.state.settings.quickReplyCustomCategories.length,1);
 h.type('settingsQuickReplies.categoryPlaceholder','日常问候');h.nodes().find(n=>n.type==='form').props.onSubmit({preventDefault(){}});h.render();assert.equal(h.state.settings.quickReplyCustomCategories.length,1);
 const loaded=normalizeLoadedSettings(JSON.parse(JSON.stringify(h.state.settings)));
 const restored=parseBackupJson({version:2,contacts:[{id:'c',name:'C',phone:'12025550123'}],settingsSafe:buildSettingsSafe(loaded)});
 assert.equal(normalizeLoadedSettings(restored.settingsSafe).quickReplyCategoryLabels.opening,'日常问候');
 assert.equal(getQuickReplyCategories(loaded.quickReplyCustomCategories,[],loaded.quickReplyCategoryLabels).find(c=>c.id==='opening').label,'日常问候');
 }finally{h.close();}
});

test('dragging default and custom categories persists order across restart and backup without moving replies',()=>{
 const h=harness([reply('a',{category:'opening'}),reply('b',{category:'quote'}),reply('c',{category:'custom'})]);try{
  h.state.settings.quickReplyCustomCategories=[{id:'custom',label:'Faith'}];h.render();
  const before=JSON.stringify(h.state.settings.quickReplies);
  h.drag('quote','opening');h.drag('custom','opening',true);
  const ids=settings=>getQuickReplyCategories(settings.quickReplyCustomCategories,settings.quickReplyRemovedCategories,settings.quickReplyCategoryLabels,settings.quickReplyCategoryOrder).map(c=>c.id);
  assert.deepEqual(ids(h.state.settings).slice(0,3),['quote','opening','custom']);
  assert.equal(JSON.stringify(h.state.settings.quickReplies),before);
  const loaded=normalizeLoadedSettings(JSON.parse(JSON.stringify(h.state.settings)));
  assert.deepEqual(ids(loaded),ids(h.state.settings));
  const restored=parseBackupJson({version:2,contacts:[{id:'c',name:'C',phone:'12025550123'}],settingsSafe:buildSettingsSafe(loaded)});
  assert.deepEqual(ids(normalizeLoadedSettings(restored.settingsSafe)),ids(loaded));
  h.click('settingsQuickReplies.manageCategories');
  assert.equal(h.find('quickLibrary.moveCategoryUp'+JSON.stringify({name:'Faith'})),undefined);
  h.find('quickLibrary.dragCategory'+JSON.stringify({name:'Faith'})).props.onKeyDown({altKey:true,key:'ArrowUp',preventDefault(){}});h.render();
  assert.deepEqual(ids(h.state.settings).slice(0,3),['quote','custom','opening']);
 }finally{h.close();}
});

test('category drops cannot accidentally change hierarchy and stored order rejects invalid IDs',()=>{
 const h=harness([]);try{
  h.state.settings.quickReplyCustomCategories=[{id:'root',label:'Book'},{id:'child',label:'Tab',parentId:'root'}];h.render();
  h.click('settingsQuickReplies.manageCategories');h.click('quickLibrary.expandCategory'+JSON.stringify({name:'Book'}));
  h.drag('root','child','inside');
  assert.equal(h.state.settings.quickReplyCategoryOrder,undefined);
  assert.equal(h.state.settings.quickReplyCustomCategories[1].parentId,'root');
  const loaded=normalizeLoadedSettings({...h.state.settings,quickReplyCategoryOrder:['child','child','unknown',null,'opening']});
  assert.deepEqual(loaded.quickReplyCategoryOrder,['child','opening']);
 }finally{h.close();}
});

test('folder-style creation and dragging replace the parent dropdowns and survive restart',()=>{
 const h=harness([reply('a',{category:'opening',media})]);try{
  h.state.settings.quickReplyCustomCategories=[{id:'book',label:'Book'}];h.render();
  h.find('quickReply.category.opening').props.onContextMenu({preventDefault(){},clientX:10,clientY:10});h.render();
  h.click('quickLibrary.newSubcategory');h.type('settingsQuickReplies.categoryPlaceholder','Greetings');
  assert.ok(h.find('quickLibrary.addInside'+JSON.stringify({name:'quickReply.category.opening'})));
  h.nodes().find(n=>n.type==='form').props.onSubmit({preventDefault(){}});h.render();
  const child=h.state.settings.quickReplyCustomCategories.find(c=>c.label==='Greetings');
  assert.equal(child.parentId,'opening');
  assert.equal(normalizeLoadedSettings(h.state.settings).quickReplyCustomCategories.find(c=>c.id===child.id).parentId,'opening');
  h.click('settingsQuickReplies.manageCategories');
  assert.equal(h.find('quickLibrary.parentCategory'),undefined);
  assert.equal(h.find('quickLibrary.rootCategory'),undefined);
  h.drag(child.id,'book','inside');
  assert.equal(h.state.settings.quickReplyCustomCategories.find(c=>c.id===child.id).parentId,'book');
  h.drag(child.id,'__root');
  assert.equal(h.state.settings.quickReplyCustomCategories.find(c=>c.id===child.id).parentId,undefined);
  assert.equal(h.state.settings.quickReplies[0].media.dataUrl,media.dataUrl);
  assert.equal(h.state.settings.quickReplies[0].category,'opening');
 }finally{h.close();}
});

test('renaming defaults does not consume custom-category capacity and stored labels reject invalid keys',()=>{
 const h=harness();try{
 h.state.settings.quickReplyCustomCategories=Array.from({length:100},(_,i)=>({id:'custom-'+i,label:'Category '+i}));h.render();h.click('settingsQuickReplies.manageCategories');
 const input=h.find('settingsQuickReplies.renameCategory'+JSON.stringify({name:'quickReply.category.opening'}));
 input.props.onBlur({currentTarget:{value:'Greeting'}});h.render();assert.equal(h.state.settings.quickReplyCustomCategories.length,100);
 const loaded=normalizeLoadedSettings({...h.state.settings,quickReplyCategoryLabels:{opening:' Greeting ',quote:'x'.repeat(33),'other':'No',unknown:'No'}});
 assert.deepEqual(loaded.quickReplyCategoryLabels,{opening:'Greeting'});assert.equal(loaded.quickReplyCustomCategories.length,100);
 }finally{h.close();}
});

test('removed-category preferences are validated and invalid reply data cannot recreate deleted defaults',()=>{
 const settings=normalizeLoadedSettings({quickReplyRemovedCategories:['opening','opening','other','unknown',null],quickReplies:null});
 assert.deepEqual(settings.quickReplyRemovedCategories,['opening']);assert.ok(settings.quickReplies.every(reply=>reply.category!=='opening'));
 assert.deepEqual(normalizeLoadedSettings({quickReplyRemovedCategories:'opening'}).quickReplyRemovedCategories,[]);
});

for(const category of ['after-sales','custom-used','custom-empty']) test(`deleting ${category} preserves content, respects confirmation, and survives reopening and backup`,async()=>{
 const used=category!=='custom-empty';
 const h=harness([reply('a',{category:used?category:'other',media}),reply('b')]);
 const label=category==='after-sales'?'quickReply.category.after-sales':'Faith';
 try{
 h.state.settings.quickReplyCustomCategories=category.startsWith('custom')?[{id:category,label}]:[];
 h.state.settings.quickReplyPinnedIds=['a'];h.state.settings.quickReplyRecentIds=['a'];
 h.state.requestConfirm=async()=>false;h.render();h.click('settingsQuickReplies.manageCategories');
 const key='settingsQuickReplies.deleteCategoryNamed'+JSON.stringify({name:label});
 await h.click(key);await new Promise(setImmediate);h.render();
 assert.ok(h.find(key),'cancel keeps the category');assert.equal(h.state.settings.quickReplies[0].category,used?category:'other');
 h.state.requestConfirm=async()=>{throw Error('dialog failed');};h.render();
 h.click(key);await new Promise(setImmediate);h.render();assert.ok(h.find(key));
 assert.equal(h.state.toasts.at(-1)[0],'common.deleteFailed');
 let confirm;h.state.requestConfirm=options=>{assert.equal(options.description,'settingsQuickReplies.deleteCategoryHint');return new Promise(resolve=>{confirm=resolve;});};h.render();
 h.click(key);
 h.state.settings.quickReplies[0]={...h.state.settings.quickReplies[0],body:'Edited while confirming'};
 if(used)h.state.settings.quickReplies.push(reply('late',{category,media}));
 h.state.settings.quickReplyCustomCategories.push({id:'keep',label:'Keep'});
 confirm(true);await new Promise(setImmediate);h.render();
 assert.equal(h.find(key),undefined);assert.ok(h.state.settings.quickReplyCustomCategories.some(item=>item.id==='keep'));
 assert.equal(h.state.settings.quickReplies.length,used?3:2);
 assert.ok(h.state.settings.quickReplies.every(item=>item.category==='other'));
 assert.equal(h.state.settings.quickReplies[0].body,'Edited while confirming');assert.deepEqual(h.state.settings.quickReplies[0].media,media);
 assert.deepEqual(h.state.settings.quickReplyPinnedIds,['a']);assert.deepEqual(h.state.settings.quickReplyRecentIds,['a']);
 assert.equal(h.state.synced,undefined);
 const check=settings=>{assert.equal(getQuickReplyCategories(settings.quickReplyCustomCategories,settings.quickReplyRemovedCategories).some(item=>item.id===category),false);assert.equal(settings.quickReplies.length,used?3:2);assert.equal(settings.quickReplies[0].media.dataUrl,media.dataUrl);};
 const loaded=normalizeLoadedSettings(JSON.parse(JSON.stringify(h.state.settings)));check(loaded);
 const restored=parseBackupJson({version:2,contacts:[{id:'c',name:'C',phone:'12025550123'}],settingsSafe:buildSettingsSafe(loaded)});
 check(normalizeLoadedSettings(restored.settingsSafe));
 }finally{h.close();}
});

test('default categories can be deleted by right click, while All and Other remain system entries',async()=>{
 const h=harness([reply('a',{category:'opening',media})]);try{
 h.state.requestConfirm=async()=>true;h.render();
 const category=label=>h.nodes().find(n=>n.type==='button'&&Array.isArray(n.props.children)&&n.props.children[0]?.props?.children===label);
 assert.equal(category('starred.all').props.onContextMenu,undefined);assert.equal(category('quickReply.category.other').props.onContextMenu,undefined);
 category('quickReply.category.opening').props.onClick();h.render();
 category('quickReply.category.opening').props.onContextMenu({preventDefault(){}});await new Promise(setImmediate);h.render();
 assert.ok(h.find('quickLibrary.deleteCategoryOnly'));
 h.click('quickLibrary.deleteCategoryOnly');await new Promise(setImmediate);h.render();
 assert.equal(category('quickReply.category.opening'),undefined);assert.equal(category('starred.all').props['aria-pressed'],true);
 assert.deepEqual(h.state.settings.quickReplies[0],reply('a',{category:'other',media}));
 h.state.settings.quickReplies=[];h.render();
 h.click('settingsQuickReplies.applyTemplates');
 assert.ok(h.state.settings.quickReplies.every(item=>item.category!=='opening'),'templates cannot resurrect a removed default category');
 }finally{h.close();}
});

test('1000 replies render at most 50 list entries and one editor; bulk changes only selected entries',()=>{
 const h=harness(Array.from({length:1000},(_,i)=>reply('r'+i)));
 try {
 assert.equal(h.nodes().filter(n=>n.props.type==='checkbox').length,51);
 assert.equal(h.nodes().filter(n=>n.type==='textarea').length,2);
 h.check('quickLibrary.selectReply'+JSON.stringify({title:'r0'}));
 h.type('quickLibrary.moveTo','opening');h.click('quickLibrary.move');
 assert.equal(h.state.settings.quickReplies[0].category,'opening');
 assert.equal(h.state.settings.quickReplies[1].category,'other');
 assert.equal(h.state.settings.quickReplies.length,1000);
 }finally{h.close();}
});

for (const outcome of ['cancel','success','sheet-failure','remote-failure']) test(`category context menu deletes its complete subtree safely (${outcome})`,async()=>{
 const link={spreadsheetId:'sheet',tab:'Tab',row:1,originalColumn:0,translationColumn:1,originalSnapshot:'Body r0',translationSnapshot:''};
 const h=harness([...Array.from({length:60},(_,i)=>reply('r'+i,{category:i%2?'child':'root',...(i===0?{sheetLink:link}:{})})),reply('keep')]);
 try{
  h.state.settings.quickReplyCustomCategories=[{id:'root',label:'Book'},{id:'child',label:'Tab',parentId:'root'},{id:'unrelated',label:'Keep'}];
  let prompts=0;h.state.requestConfirm=async()=>{prompts++;return outcome!=='cancel';};
  if(outcome==='sheet-failure')h.state.removeSheetRow=async()=>{throw Error('quickReplySheetConflict');};
  if(outcome==='remote-failure'){h.state.connected=true;h.state.removeRemote=async()=>{throw Error('offline');};}
  h.render();h.find('Book').props.onContextMenu({preventDefault(){},clientX:10,clientY:10});h.render();
  h.click('quickLibrary.deleteCategoryContents'+JSON.stringify({count:60}));await new Promise(setImmediate);h.render();
  assert.equal(prompts,1,'a subtree deletion needs just one confirmation');
  assert.ok(h.state.settings.quickReplies.some(r=>r.id==='keep'));
  if(outcome==='success'){
   assert.deepEqual(h.state.settings.quickReplies.map(r=>r.id),['keep']);
   assert.deepEqual(h.state.settings.quickReplyCustomCategories.map(c=>c.id),['unrelated']);
  }else{
   assert.ok(h.state.settings.quickReplyCustomCategories.some(c=>c.id==='root'));
   assert.ok(h.state.settings.quickReplies.some(r=>r.id==='r0'));
   assert.equal(h.state.settings.quickReplies.length,outcome==='sheet-failure'?2:61);
  }
 }finally{h.close();}
});

test('select all results moves replies across pages without touching other categories',()=>{
 const h=harness([...Array.from({length:60},(_,i)=>reply('r'+i,{category:'opening'})),reply('keep')]);
 try{
  h.click('quickReply.category.opening');h.click('quickLibrary.selectAllMatches'+JSON.stringify({count:60}));
  h.type('quickLibrary.moveTo','quote');h.click('quickLibrary.move');
  assert.equal(h.state.settings.quickReplies.filter(r=>r.category==='quote').length,60);
  assert.equal(h.state.settings.quickReplies.find(r=>r.id==='keep').category,'other');
 }finally{h.close();}
});

test('category context menu renames and moves folders without opening the manager',()=>{
 const h=harness([reply('a',{category:'root'})]);try{
  h.state.settings.quickReplyCustomCategories=[{id:'root',label:'Book'},{id:'target',label:'Destination'}];h.render();
  h.find('Book').props.onContextMenu({preventDefault(){},clientX:10,clientY:10});h.render();
  h.find('settingsQuickReplies.renameCategory'+JSON.stringify({name:'Book'})).props.onBlur({currentTarget:{value:'Renamed'}});h.render();
  h.click('quickLibrary.moveCategory');h.click('quickLibrary.moveInside'+JSON.stringify({name:'Destination'}));
  assert.deepEqual(h.state.settings.quickReplyCustomCategories.find(c=>c.id==='root'),{id:'root',label:'Renamed',parentId:'target'});
  assert.equal(h.find('quick-reply-category-manager'),undefined);
 }finally{h.close();}
});

test('selected sheet tabs import directly with their chosen columns and keep source links',async()=>{
 const h=harness([]);try{
  h.state.email='test@example.com';h.state.readSheet=async(id,ranges)=>ranges?{valueRanges:[{values:[['中文原文','你好'],['法语译文','Bonjour']]}]}:{properties:{title:'Book'},sheets:[{properties:{title:'First'}},{properties:{title:'Second'}}]};
  h.render();h.click('quickLibrary.import');h.type('quickLibrary.sheetUrl','https://docs.google.com/spreadsheets/d/sheet/');
  h.click('quickLibrary.fetchTabs');await new Promise(setImmediate);h.render();
  h.click('quickLibrary.deselectAll');h.check('Second');
  h.type('quickLibrary.originalColumn','1');h.type('quickLibrary.titleSource','translation');
  h.click('quickLibrary.importSelectedTabs'+JSON.stringify({count:1}));await new Promise(setImmediate);h.render();
  assert.equal(h.state.settings.quickReplies.length,1);
  const imported=h.state.settings.quickReplies[0];
  assert.equal(imported.title,'你好');assert.equal(imported.body,'Bonjour');assert.equal(imported.translation,'你好');
  assert.equal(imported.sheetLink.tab,'Second');assert.equal(imported.sheetLink.row,2);assert.equal(imported.sheetLink.originalColumn,1);
  assert.equal(h.state.settings.quickReplyCustomCategories.find(c=>c.id===imported.category).label,'Second');
  assert.equal(h.find('quickLibrary.confirmImport'),undefined);
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

for (const localEdit of [false,true,'during-confirm']) test(`reimport uses the saved baseline and protects concurrent edits (${localEdit})`,async()=>{
 const sheetLink={spreadsheetId:'sheet',tab:'Tab',row:1,originalColumn:0,translationColumn:1,titleSnapshot:'Greeting',originalSnapshot:'Old',translationSnapshot:'旧'};
 const h=harness([reply('a',{title:'Greeting',body:localEdit?'Local edit':'Old',translation:'旧',sheetLink})]);
 try{
  let prompts=0;h.state.email='test@example.com';h.state.syncIds=[];
  h.state.requestConfirm=async()=>{prompts++;if(localEdit==='during-confirm')h.state.updateSettings({quickReplies:[...h.state.settings.quickReplies,reply('new')]});return false;};
  h.state.readSheet=async(id,ranges)=>ranges?{valueRanges:[{values:[['Remote edit'],['新']]}]}:{properties:{title:'Book'},sheets:[{properties:{title:'Tab'}}]};
  h.render();h.click('quickLibrary.import');h.type('quickLibrary.sheetUrl','https://docs.google.com/spreadsheets/d/sheet/');
  h.click('quickLibrary.fetchTabs');await new Promise(setImmediate);h.render();
  h.click('quickLibrary.importSelectedTabs'+JSON.stringify({count:1}));await new Promise(setImmediate);h.render();
  if(localEdit==='during-confirm'){
   assert.equal(h.state.settings.quickReplies.length,2);
   assert.equal(h.state.settings.quickReplies[0].body,'Local edit');
   assert.ok(h.state.toasts.some(([key])=>key==='quickLibrary.importChanged'));return;
  }
  assert.equal(h.find('quickLibrary.confirmImport'),undefined,'sheet import completes without the paste-preview confirmation');
  assert.equal(h.state.settings.quickReplies.length,1);
  assert.equal(h.state.settings.quickReplies[0].body,'Remote edit');
  assert.equal(h.state.settings.quickReplies[0].translation,'新');
  assert.equal(prompts,localEdit?1:0);
  assert.deepEqual(h.state.syncIds,[],'remote-only edits must never write stale local content back');
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
