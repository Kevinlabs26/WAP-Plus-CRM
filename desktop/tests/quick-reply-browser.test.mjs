import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const translations='export const useI18n=()=>({t:(k,p)=>k+(p?JSON.stringify(p):""),locale:"en"});';
const mocks={
 react:'export const lazy=()=>"quick-import";export const Suspense="suspense";export const useState=i=>globalThis.shelfHooks.state(i);export const useRef=i=>globalThis.shelfHooks.ref(i);export const useMemo=f=>f();export const useEffect=()=>{};export const useId=()=>"preview-title";',
 'react/jsx-runtime':'export const Fragment="fragment";export const jsx=(type,props)=>({type,props});export const jsxs=jsx;',
 'react-dom':'export const createPortal=children=>children;',
 'lucide-react':'export const GripVertical="drag-icon",FileText="file-icon",Image="image-icon",Music2="audio-icon",Pin="pin-icon",Play="video-icon",Search="search-icon",Send="send-icon",X="close-icon",Zap="zap-icon";',
 '@/components/ui/primitives':'export const Button="button",Input="input",Textarea="textarea";',
 '@/i18n':translations,
 '@/components/settings/SettingsQuickRepliesPanel':'export const SettingsQuickRepliesPanel="quick-import";',
 '@/lib/quickReplySheetSync':'export const scheduleQuickReplySheetSync=id=>globalThis.shelfSynced?.push(id);',
 '@/store/appStore':'export const useAppStore=f=>f(globalThis.shelfState);useAppStore.getState=()=>globalThis.shelfState;',
};
const out=await build({stdin:{contents:`export {QuickReplyBrowser,QuickReplyPreview} from './src/components/chat/QuickReplyBrowser.tsx';export {MultiWindowQuickReplies} from './src/features/multiWindow/components/MultiWindowQuickReplies.tsx';`,resolveDir:root},bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',alias:{'@':root+'src'},plugins:[{name:'shelf-ui',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {QuickReplyBrowser,QuickReplyPreview,MultiWindowQuickReplies}=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text+'\n//# sourceURL=quick-reply-browser-test.js').toString('base64'));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree?.props?[tree,...nodes(tree.props.children)]:[];
const media={kind:'image',dataUrl:'data:image/png;base64,AA==',fileName:'invitation.png',mimeType:'image/png',size:1024};
const reply=(id,extra={})=>({id,title:'Reply '+id,body:'Body '+id,category:'other',...extra});
const categoryToggle=(name,open=false)=>`quickLibrary.${open?'collapseCategory':'expandCategory'}${JSON.stringify({name})}`;
function harness(component=QuickReplyBrowser,props={}){
 let slots=[],cursor=0,tree;const inserted=[];
 const h={props:{replies:[reply('one',{media})],categories:[],contextKey:'main:a',onInsert:r=>inserted.push(r),...props},inserted,
 render(){cursor=0;globalThis.shelfHooks={state(i){const at=cursor++;if(!(at in slots))slots[at]=typeof i==='function'?i():i;return [slots[at],v=>{slots[at]=typeof v==='function'?v(slots[at]):v;}];},ref(i){const at=cursor++;return slots[at]??(slots[at]={current:i});}};tree=component(h.props);return tree;},
 nodes:()=>nodes(tree),find(label){const matches=h.nodes().filter(n=>n.props['aria-label']===label||n.props.children===label);return matches.find(n=>n.props.onClick)||matches[0];},
 click(label){const n=h.find(label);assert.ok(n,'missing '+label);n.props.onClick();h.render();},preview:()=>h.nodes().find(n=>n.type===QuickReplyPreview)};
 h.render();return h;
}

function shelfStore(replies=[]) {
 const store={settings:{quickReplies:replies,quickReplyCustomCategories:[]},toasts:[],updateSettings(patch){store.settings={...store.settings,...patch};},pushToast(...args){store.toasts.push(args);}};
 globalThis.shelfState=store;return store;
}

test('adding a reply stays in the chat shelf, saves once against the latest library and never sends or opens management',()=>{
 const store=shelfStore(),h=harness(QuickReplyBrowser,{replies:[],disabled:true,onManage:()=>assert.fail('must stay in shelf')});
 h.click('settingsQuickReplies.add');assert.ok(h.preview().props.inline);assert.equal(store.settings.quickReplies.length,0);
 h.preview().props.onChange({body:'Bonjour !',translation:'你好！',category:'opening',media});h.render();
 store.updateSettings({quickReplies:[reply('concurrent')]});
 const save=h.preview().props.onSave;save();save();h.render();
 assert.equal(store.settings.quickReplies.length,2,'double save cannot append the same ID twice');
 assert.equal(store.settings.quickReplies[0].id,'concurrent');
 const created=store.settings.quickReplies[1];assert.equal(created.title,'Bonjour !');assert.equal(created.translation,'你好！');assert.equal(created.media,media);assert.equal(created.category,'opening');
 assert.equal(h.inserted.length,0);assert.equal(h.preview(),undefined);
 h.props={...h.props,replies:store.settings.quickReplies};h.render();assert.ok(h.find('Bonjour !'));
 h.click('settingsQuickReplies.add');h.preview().props.onChange({body:'Discard me'});h.render();h.preview().props.onClose();h.render();
 assert.equal(store.settings.quickReplies.length,2);
});

test('a category can be added while drafting; empty categories are visible and the draft uses the new category',()=>{
 const store=shelfStore(),h=harness(QuickReplyBrowser,{replies:[]});
 h.click('settingsQuickReplies.add');h.preview().props.onChange({body:'Keep this draft'});h.render();
 h.click('settingsQuickReplies.addCategory');
 h.find('settingsQuickReplies.categoryPlaceholder').props.onChange({target:{value:'Invitations'}});h.render();
 h.nodes().find(n=>n.type==='form').props.onSubmit({preventDefault(){}});h.render();
 assert.equal(store.settings.quickReplies.length,0);const category=store.settings.quickReplyCustomCategories[0];assert.equal(category.label,'Invitations');
 assert.equal(h.preview().props.reply.body,'Keep this draft');assert.equal(h.preview().props.reply.category,category.id);
 h.props.categories=store.settings.quickReplyCustomCategories;h.render();assert.ok(h.find('Invitations'),'new empty categories remain visible');
 h.preview().props.onSave();h.render();assert.equal(store.settings.quickReplies[0].category,category.id);
 h.click('settingsQuickReplies.addCategory');h.find('settingsQuickReplies.categoryPlaceholder').props.onChange({target:{value:'invitations'}});h.render();h.nodes().find(n=>n.type==='form').props.onSubmit({preventDefault(){}});h.render();
 assert.equal(store.settings.quickReplyCustomCategories.length,1);assert.ok(store.toasts.some(([key])=>key==='settingsQuickReplies.categoryExists'));
});

test('quick creation respects current limits, handles a removed category and keeps Google Sheet linkage for new rows',()=>{
 const store=shelfStore(),h=harness(QuickReplyBrowser,{replies:[]});
 h.click('settingsQuickReplies.add');h.preview().props.onChange({body:'Saved later',category:'removed-category',media:{...media,size:2*1024*1024}});h.render();
 store.updateSettings({quickReplies:Array.from({length:1000},(_,i)=>reply(String(i)))});h.preview().props.onSave();h.render();assert.equal(store.settings.quickReplies.length,1000);assert.ok(h.preview());
 store.updateSettings({quickReplies:[reply('large',{media:{...media,size:63*1024*1024}})]});h.preview().props.onSave();h.render();assert.equal(store.settings.quickReplies.length,1);assert.ok(h.preview());
 const link={spreadsheetId:'book',tab:'Tab',row:2,originalColumn:1,translationColumn:0,originalSnapshot:'Old',translationSnapshot:'Ancien'};
 store.updateSettings({quickReplies:[reply('linked',{sheetLink:link})]});globalThis.shelfSynced=[];
 try {h.preview().props.onSave();h.render();const created=store.settings.quickReplies[1];assert.equal(created.category,'other');assert.equal(created.sheetLink.row,0);assert.equal(created.sheetLink.originalColumn,1);assert.equal(created.sheetLink.originalSnapshot,'');assert.deepEqual(globalThis.shelfSynced,[created.id]);}
 finally {delete globalThis.shelfSynced;}
});

test('direct import mounts only the existing importer and returns to the shelf with imported categories expanded',()=>{
 const store=shelfStore(),h=harness(QuickReplyBrowser,{replies:[],onManage:()=>assert.fail('must not open settings')});
 h.click('quickShelf.import');const importer=h.nodes().find(n=>n.type==='quick-import');assert.ok(importer.props.importOnly);assert.equal(importer.props.defaultCategory,'other');
 assert.equal(h.find('settingsQuickReplies.add').props.disabled,true);
 store.updateSettings({quickReplyCustomCategories:[{id:'book',label:'Workbook'},{id:'tab',label:'Sheet',parentId:'book'}]});
 importer.props.onImported(['tab']);h.props={...h.props,categories:store.settings.quickReplyCustomCategories,replies:[reply('new',{category:'tab'})]};h.render();
 assert.equal(h.nodes().some(n=>n.type==='quick-import'),false);assert.ok(h.find('Reply new'));assert.equal(h.find(categoryToggle('Workbook',true)).props['aria-expanded'],true);
});

test('the shared editor renders a compact inline creation form with categories and Save instead of sending controls',()=>{
 const patches=[],h=harness(QuickReplyPreview,{reply:reply('draft',{body:'',translation:''}),inline:true,categories:[{id:'opening',label:'Opening'},{id:'other',label:'Other'}],onChange:patch=>patches.push(patch),onSave(){},onInsert:()=>assert.fail('creation must never insert'),onClose(){},disabled:false});
 assert.equal(h.nodes().some(n=>n.props.role==='dialog'),false);assert.ok(h.nodes().some(n=>n.props.role==='region'));
 assert.equal(h.find('common.save').props.disabled,true);assert.equal(h.find('quickShelf.insert'),undefined);
 h.find('settingsQuickReplies.category').props.onChange({target:{value:'opening'}});assert.deepEqual(patches,[{category:'opening'}]);
 h.props.reply={...h.props.reply,translation:'你好'};h.render();assert.equal(h.find('common.save').props.disabled,false);
});

test('renamed default categories appear in the quick-reply shelf with their original IDs',()=>{
 const h=harness(QuickReplyBrowser,{replies:[reply('one',{category:'opening',media})],categoryLabels:{opening:'日常问候'}});
 assert.ok(h.find('日常问候'));assert.equal(h.find('quickReply.category.opening'),undefined);
 assert.equal(h.find(categoryToggle('日常问候',true)).props['aria-expanded'],true);assert.ok(h.find('Reply one'));
 h.click(categoryToggle('日常问候',true));assert.equal(h.find('Reply one'),undefined);
 h.click(categoryToggle('日常问候'));assert.ok(h.find('Reply one'));
});

test('the chat shelf uses the category order saved in the manager',()=>{
 const h=harness(QuickReplyBrowser,{replies:[reply('a',{category:'opening'}),reply('b',{category:'quote'})],categoryOrder:['quote','opening']});
 const position=label=>h.nodes().findIndex(n=>n.props.children===label);
 assert.ok(position('quickReply.category.quote')<position('quickReply.category.opening'));
});

test('deleting a category removes its group and keeps its replies under Other',()=>{
 const h=harness(QuickReplyBrowser,{replies:[reply('one',{category:'after-sales',media})]});
 h.props={...h.props,removedCategories:['after-sales'],replies:[reply('one',{category:'other',media})]};h.render();
 assert.equal(h.find(categoryToggle('quickReply.category.after-sales',true)),undefined);
 h.click(categoryToggle('quickReply.category.other'));assert.ok(h.find('Reply one'));
});

test('1000 replies render one page and search covers attachment filenames',()=>{
 const replies=Array.from({length:1000},(_,i)=>reply(String(i),i===998?{media}:{}));const h=harness(QuickReplyBrowser,{replies});
 assert.equal(h.nodes().filter(n=>n.type==='article').length,50);h.click('quickShelf.nextPage');assert.ok(h.find('Reply 50'));
 h.find('multi.searchQuickReplies').props.onChange({target:{value:'invitation.png'}});h.render();
 assert.equal(h.nodes().filter(n=>n.type==='article').length,1);assert.ok(h.find('Reply 998'));assert.equal(h.find('quickShelf.nextPage'),undefined);
});
test('custom categories expand alongside open categories and disappear when removed',()=>{
 const h=harness(QuickReplyBrowser,{replies:[reply('a'),reply('b',{category:'custom'})],categories:[{id:'custom',label:'Invitation'}]});
 h.click(categoryToggle('Invitation'));assert.ok(h.find('Reply b'));assert.ok(h.find('Reply a'));
 h.props={...h.props,categories:[],replies:[reply('a'),reply('b',{category:'other'})]};h.render();assert.equal(h.nodes().filter(n=>n.type==='article').length,2);
});
test('category plus controls stay independent so multiple nested categories can remain open',()=>{
 const h=harness(QuickReplyBrowser,{replies:[reply('greeting',{category:'custom-greeting'}),reply('followup',{category:'custom-followup'})],categories:[{id:'custom-root',label:'Workbook'},{id:'custom-greeting',label:'Greeting',parentId:'custom-root'},{id:'custom-followup',label:'Follow-up',parentId:'custom-root'}]});
 assert.ok(h.find('Reply greeting'));assert.equal(h.find('Reply followup'),undefined);
 h.click(categoryToggle('Follow-up'));assert.ok(h.find('Reply greeting'));assert.ok(h.find('Reply followup'));
 h.click(categoryToggle('Workbook',true));assert.equal(h.find('Greeting'),undefined);assert.equal(h.find('Reply greeting'),undefined);
 h.click(categoryToggle('Workbook'));assert.ok(h.find('Reply greeting'));assert.ok(h.find('Reply followup'));
});
test('preview does not insert, and insertion uses the latest text and media rather than an old snapshot',()=>{
 const h=harness();h.click('quickShelf.previewNamed'+JSON.stringify({title:'Reply one'}));assert.equal(h.inserted.length,0);assert.equal(h.preview().props.reply.media.fileName,'invitation.png');
 h.props.replies=[reply('one',{body:'Updated text',media:{...media,fileName:'updated.png'}})];h.render();assert.equal(h.preview().props.reply.body,'Updated text');
 h.preview().props.onInsert();h.render();assert.equal(h.inserted.length,1);assert.equal(h.inserted[0].media.fileName,'updated.png');assert.equal(h.preview(),undefined);
});
test('changing the target chat or deleting a reply closes the old preview',()=>{
 const h=harness();h.click('quickShelf.previewNamed'+JSON.stringify({title:'Reply one'}));h.props.contextKey='main:b';h.render();assert.equal(h.preview(),undefined);
 h.click('quickShelf.previewNamed'+JSON.stringify({title:'Reply one'}));h.props.replies=[];h.render();assert.equal(h.preview(),undefined);assert.equal(h.inserted.length,0);
});
test('blocked media insertion keeps the preview open and disabled chat cannot insert',()=>{
 const h=harness(QuickReplyBrowser,{onInsert:()=>false});h.click('quickShelf.previewNamed'+JSON.stringify({title:'Reply one'}));h.preview().props.onInsert();h.render();assert.ok(h.preview());
 h.props.disabled=true;h.render();h.find('quickShelf.insertOriginal').props.onClick();assert.equal(h.inserted.length,0);assert.ok(h.find('quickShelf.chooseChat'));
});
test('a media-only reply remains insertable and carries its attachment',()=>{
 const h=harness(QuickReplyBrowser,{replies:[reply('one',{body:'',media})]});h.click('quickShelf.insertOriginal');assert.equal(h.inserted[0].body,'');assert.equal(h.inserted[0].media.dataUrl,media.dataUrl);
});

test('bilingual cards display the translation and let the user insert either text',()=>{
 const h=harness(QuickReplyBrowser,{replies:[reply('one',{body:'Bonjour',translation:'Hello there'})]});
 assert.ok(h.nodes().some(n=>n.type==='span'&&n.props.children==='Hello there'));
 h.click('quickShelf.insertOriginal');assert.equal(h.inserted[0].body,'Bonjour');
 h.click('quickShelf.previewNamed'+JSON.stringify({title:'Reply one'}));h.preview().props.onInsert('Hello there');
 assert.equal(h.inserted[1].body,'Hello there');
});

test('toggling between original and translation updates card text on the shelf',()=>{
 const h=harness(QuickReplyBrowser,{replies:[reply('one',{body:'Bonjour tout le monde',translation:'大家早上好'})]});
 assert.ok(h.nodes().some(n=>n.type==='span'&&n.props.children==='大家早上好'));
 assert.ok(!h.nodes().some(n=>n.type==='span'&&n.props.children==='Bonjour tout le monde'));

 h.click('quickShelf.showOriginal');
 assert.ok(h.nodes().some(n=>n.type==='span'&&n.props.children==='Bonjour tout le monde'));
 assert.ok(!h.nodes().some(n=>n.type==='span'&&n.props.children==='大家早上好'));

 h.click('quickShelf.showTranslation');
 assert.ok(h.nodes().some(n=>n.type==='span'&&n.props.children==='大家早上好'));
});

test('opening a reply lets the user edit text and replace image, audio, or video media',()=>{
 const original=globalThis.document;globalThis.document={body:{}};
 try{
  const patches=[];const h=harness(QuickReplyPreview,{reply:reply('one',{title:'Salut',body:'Bonjour',translation:'Hello',media}),category:'Other',disabled:false,onChange:patch=>patches.push(patch),onInsert(){},onClose(){}});
  h.find('settingsQuickReplies.commandTitle').props.onChange({target:{value:'New title'}});
  h.find('settingsQuickReplies.content').props.onChange({target:{value:'New original'}});
  h.find('settingsQuickReplies.translation').props.onChange({target:{value:'New translation'}});
  assert.deepEqual(patches.slice(0,3),[{title:'New title'},{body:'New original'},{translation:'New translation'}]);
  assert.match(h.nodes().find(n=>n.props.type==='file').props.accept,/image\/\*,audio\/\*,video\/\*/);
  h.click('settingsQuickReplies.removeMedia');assert.deepEqual(patches[3],{media:undefined});
 }finally{if(original===undefined)delete globalThis.document;else globalThis.document=original;}
});

test('editing from the preview saves the changed reply to app settings immediately',()=>{
 const original=globalThis.shelfState;const saved=reply('one',{body:'Before'});
 const state={settings:{quickReplies:[saved]},pushToast(){},updateSettings(patch){state.settings={...state.settings,...patch};}};
 globalThis.shelfState=state;
 try{
  const h=harness(QuickReplyBrowser,{replies:[saved]});h.click('quickShelf.previewNamed'+JSON.stringify({title:'Reply one'}));
  h.preview().props.onChange({body:'After'});assert.equal(state.settings.quickReplies[0].body,'After');
 }finally{if(original===undefined)delete globalThis.shelfState;else globalThis.shelfState=original;}
});

test('preview media replacement classifies audio and video files correctly',async()=>{
 const oldDocument=globalThis.document,oldReader=globalThis.FileReader,oldState=globalThis.shelfState;globalThis.document={body:{}};
 const readers=[],toasts=[];globalThis.shelfState={settings:{quickReplies:[]},pushToast:message=>toasts.push(message)};
 globalThis.FileReader=class{constructor(){readers.push(this);}readAsDataURL(){} };
 try{
  for(const [kind,type] of [['audio','audio/mpeg'],['video','video/mp4']]){
   const patches=[];const h=harness(QuickReplyPreview,{reply:reply('one'),category:'Other',disabled:false,onChange:patch=>patches.push(patch),onInsert(){},onClose(){}});
   const file={name:`sample.${kind}`,type,size:10};h.nodes().find(n=>n.props.type==='file').props.onChange({target:{files:[file]},currentTarget:{value:'selected'}});
   const reader=readers.at(-1);reader.result=`data:${type};base64,AA==`;reader.onload();await new Promise(setImmediate);
   assert.equal(patches[0].media.kind,kind);
  }
  assert.equal(toasts.length,2);
 }finally{
  if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;
  if(oldReader===undefined)delete globalThis.FileReader;else globalThis.FileReader=oldReader;
  if(oldState===undefined)delete globalThis.shelfState;else globalThis.shelfState=oldState;
 }
});

test('pinned replies lead within groups; pinned and recent views respect search across open categories',()=>{
 const replies=[reply('a'),reply('b',{category:'opening'}),reply('c')];const pinned=[];
 const h=harness(QuickReplyBrowser,{replies,pinnedIds:['c'],recentIds:['b','c','missing'],onTogglePin:id=>pinned.push(id)});
 const titles=()=>h.nodes().filter(n=>n.props.role==='heading').map(n=>n.props.children);
 h.click(categoryToggle('quickReply.category.opening'));
 assert.deepEqual(titles(),['Reply b','Reply c','Reply a']);assert.deepEqual(replies.map(r=>r.id),['a','b','c']);
 h.click('quickShelf.unpin'+JSON.stringify({title:'Reply c'}));assert.deepEqual(pinned,['c']);
 h.click('quickShelf.view.pinned');assert.deepEqual(titles(),['Reply c']);
 h.click('quickShelf.view.recent');assert.deepEqual(titles(),['Reply b','Reply c']);
 h.find('multi.searchQuickReplies').props.onChange({target:{value:'missing'}});h.render();assert.deepEqual(titles(),[]);
});

test('previewing and refused insertion do not update recents; successful insertion records one use',()=>{
 const used=[];let accepted=false;const h=harness(QuickReplyBrowser,{onInsert:()=>accepted,onUsed:id=>used.push(id)});
 h.click('quickShelf.view.recent');assert.ok(h.find('quickShelf.empty.recent'));h.click('quickShelf.view.all');
 h.click('quickShelf.previewNamed'+JSON.stringify({title:'Reply one'}));assert.deepEqual(used,[]);h.preview().props.onInsert();h.render();assert.deepEqual(used,[]);
 accepted=true;h.preview().props.onInsert();h.render();assert.deepEqual(used,['one']);assert.equal(h.preview(),undefined);
 h.props.disabled=true;h.render();h.click('quickShelf.insertOriginal');assert.deepEqual(used,['one']);
});

test('preview carries the current target chat and sending identity; account changes hide the old preview',()=>{
 const target={title:'Grace',account:'2: Alexandre'};const h=harness(QuickReplyBrowser,{target});
 h.click('quickShelf.previewNamed'+JSON.stringify({title:'Reply one'}));assert.deepEqual(h.preview().props.target,target);
 h.props.contextKey='main:a:account-b';h.render();assert.equal(h.preview(),undefined);
 const original=globalThis.document;globalThis.document={body:{}};
 try{
 const p=harness(QuickReplyPreview,{reply:reply('one'),category:'Other',target,disabled:false,onInsert(){},onClose(){}});
 assert.ok(p.nodes().some(n=>n.type==='p'&&Array.isArray(n.props.children)&&n.props.children.join('')==='Grace · 2: Alexandre'));
 }finally{globalThis.document=original;}
});

test('multi-window shelf labels the chat owner instead of the globally active account and shares pin/history actions',()=>{
 const state={settings:{quickReplies:[reply('a')],quickReplyCustomCategories:[],quickReplyPinnedIds:['a'],quickReplyRecentIds:['a'],sendChannel:'baileys',activeAccountId:'wa-a',liveBaileysAccountId:'wa-a',waAccounts:[{id:'wa-a',label:'1',userName:'Alice',status:'connected'},{id:'wa-b',label:'2',userName:'Bob',status:'connected'}]},chats:[{id:'chat-b',contactId:'b',contactName:'Grace',accountId:'wa-b',phoneId:'phone-b'}],contacts:[{id:'b'}],phones:[{id:'phone-b',name:'Pixel'}],baileysUi:{connection:'connected'},toggleQuickReplyPin(){},recordQuickReplyUsage(){},pushToast(){}};
 globalThis.shelfState=state;const picked=[];const h=harness(MultiWindowQuickReplies,{chatId:'chat-b',onPick:text=>picked.push(text)});
 const browser=()=>h.nodes().find(n=>n.type===QuickReplyBrowser).props;
 state.settings.quickReplyRemovedCategories=['after-sales'];h.render();assert.strictEqual(browser().removedCategories,state.settings.quickReplyRemovedCategories);
 state.settings.quickReplyCategoryLabels={opening:'Greetings'};h.render();assert.strictEqual(browser().categoryLabels,state.settings.quickReplyCategoryLabels);
 assert.deepEqual(browser().target,{title:'Grace',account:'2: Bob'});assert.strictEqual(browser().pinnedIds,state.settings.quickReplyPinnedIds);assert.strictEqual(browser().onUsed,state.recordQuickReplyUsage);
 const oldContext=browser().contextKey;state.settings.waAccounts[1].userName='Bob updated';h.render();assert.equal(browser().target.account,'2: Bob updated');
 browser().onInsert(reply('a'));assert.deepEqual(picked,['Body a']);
 assert.equal(browser().onInsert(reply('a',{media})),false,'missing composer cannot acknowledge media');
 state.settings.sendChannel='android_bridge';h.render();assert.match(browser().target.account,/Pixel/);assert.notEqual(browser().contextKey,oldContext);
 state.chats=[];h.render();assert.equal(browser().disabled,true);assert.equal(browser().onInsert(reply('a')),false);assert.equal(picked.length,1);
 delete globalThis.shelfState;
});
test('preview loads only its selected media, supports failure feedback and never auto-plays',()=>{
 const original=globalThis.document;globalThis.document={body:{}};
 try{
 for(const kind of ['image','audio','video','file']){
  const h=harness(QuickReplyPreview,{reply:reply('one',{media:{...media,kind}}),category:'Other',disabled:false,onInsert(){},onClose(){}});
  const players=h.nodes().filter(n=>['img','audio','video'].includes(n.type));assert.equal(players.length,kind==='file'?0:1);
  if(players[0]){assert.notEqual(players[0].props.autoPlay,true);players[0].props.onError();h.render();assert.ok(h.find('quickShelf.previewUnavailable'));}
 }
 }finally{globalThis.document=original;}
});

test('actual rendered cards lazy-load images and do not instantiate audio or video players for the list',async()=>{
 const rendered=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {QuickReplyBrowser} from './src/components/chat/QuickReplyBrowser.tsx';export const render=props=>renderToStaticMarkup(React.createElement(QuickReplyBrowser,props));`,resolveDir:root},bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',alias:{'@':root+'src'},banner:{js:`import {createRequire} from 'node:module';const require=createRequire(${JSON.stringify(new URL('../package.json',import.meta.url).href)});`},plugins:[{name:'shelf-translations',setup(b){b.onResolve({filter:/^@\/i18n$/},()=>({path:'i18n',namespace:'mock'}));b.onResolve({filter:/^@\/store\/appStore$/},()=>({path:'app-store',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='i18n'?translations:'export const useAppStore=Object.assign(()=>{}, {getState:()=>({settings:{quickReplies:[]},updateSettings(){},pushToast(){}})});'}));}}]});
 const {render}=await import('data:text/javascript;base64,'+Buffer.from(rendered.outputFiles[0].text+'\n//# sourceURL=quick-shelf-ssr-test.js').toString('base64'));
 const replies=Array.from({length:1000},(_,i)=>reply(String(i),{body:'<script>alert(1)</script>',translation:'<script>alert(1)</script>',media:{...media,kind:['image','audio','video','file'][i%4]}}));
 const html=render({replies,contextKey:'main:a',onInsert(){}});assert.equal((html.match(/<article/g)||[]).length,50);assert.match(html,/loading="lazy"/);assert.match(html,/decoding="async"/);assert.doesNotMatch(html,/<audio|<video|<script/);assert.match(html,/&lt;script&gt;/);
});
