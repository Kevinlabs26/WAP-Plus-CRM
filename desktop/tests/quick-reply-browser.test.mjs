import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const translations='export const useI18n=()=>({t:(k,p)=>k+(p?JSON.stringify(p):""),locale:"en"});';
const mocks={
 react:'export const useState=i=>globalThis.shelfHooks.state(i);export const useRef=i=>globalThis.shelfHooks.ref(i);export const useMemo=f=>f();export const useEffect=()=>{};export const useId=()=>"preview-title";',
 'react/jsx-runtime':'export const Fragment="fragment";export const jsx=(type,props)=>({type,props});export const jsxs=jsx;',
 'react-dom':'export const createPortal=children=>children;',
 'lucide-react':'export const FileText="file-icon",Image="image-icon",Music2="audio-icon",Pin="pin-icon",Play="video-icon",Search="search-icon",X="close-icon",Zap="zap-icon";',
 '@/components/ui/primitives':'export const Button="button";',
 '@/i18n':translations,
 '@/store/appStore':'export const useAppStore=f=>f(globalThis.shelfState);useAppStore.getState=()=>globalThis.shelfState;',
};
const out=await build({stdin:{contents:`export {QuickReplyBrowser,QuickReplyPreview} from './src/components/chat/QuickReplyBrowser.tsx';export {MultiWindowQuickReplies} from './src/features/multiWindow/components/MultiWindowQuickReplies.tsx';`,resolveDir:root},bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',alias:{'@':root+'src'},plugins:[{name:'shelf-ui',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {QuickReplyBrowser,QuickReplyPreview,MultiWindowQuickReplies}=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text+'\n//# sourceURL=quick-reply-browser-test.js').toString('base64'));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree?.props?[tree,...nodes(tree.props.children)]:[];
const media={kind:'image',dataUrl:'data:image/png;base64,AA==',fileName:'invitation.png',mimeType:'image/png',size:1024};
const reply=(id,extra={})=>({id,title:'Reply '+id,body:'Body '+id,category:'other',...extra});
function harness(component=QuickReplyBrowser,props={}){
 let slots=[],cursor=0,tree;const inserted=[];
 const h={props:{replies:[reply('one',{media})],categories:[],contextKey:'main:a',onInsert:r=>inserted.push(r),...props},inserted,
 render(){cursor=0;globalThis.shelfHooks={state(i){const at=cursor++;if(!(at in slots))slots[at]=typeof i==='function'?i():i;return [slots[at],v=>{slots[at]=typeof v==='function'?v(slots[at]):v;}];},ref(i){const at=cursor++;return slots[at]??(slots[at]={current:i});}};tree=component(h.props);return tree;},
 nodes:()=>nodes(tree),find(label){return h.nodes().find(n=>n.props['aria-label']===label||n.props.children===label);},
 click(label){const n=h.find(label);assert.ok(n,'missing '+label);n.props.onClick();h.render();},preview:()=>h.nodes().find(n=>n.type===QuickReplyPreview)};
 h.render();return h;
}

test('1000 replies render one page and search covers attachment filenames',()=>{
 const replies=Array.from({length:1000},(_,i)=>reply(String(i),i===998?{media}:{}));const h=harness(QuickReplyBrowser,{replies});
 assert.equal(h.nodes().filter(n=>n.type==='article').length,50);h.click('quickShelf.nextPage');assert.ok(h.find('Reply 50'));
 h.find('multi.searchQuickReplies').props.onChange({target:{value:'invitation.png'}});h.render();
 assert.equal(h.nodes().filter(n=>n.type==='article').length,1);assert.ok(h.find('Reply 998'));assert.equal(h.find('quickShelf.nextPage'),undefined);
});
test('category filtering works with custom categories and falls back when a category is removed',()=>{
 const h=harness(QuickReplyBrowser,{replies:[reply('a'),reply('b',{category:'custom'})],categories:[{id:'custom',label:'Invitation'}]});
 h.find('multi.quickReplyCategories').props.onChange({target:{value:'custom'}});h.render();assert.ok(h.find('Reply b'));assert.equal(h.find('Reply a'),undefined);
 h.props.categories=[];h.render();assert.equal(h.nodes().filter(n=>n.type==='article').length,2);
});
test('preview does not insert, and insertion uses the latest text and media rather than an old snapshot',()=>{
 const h=harness();h.click('quickShelf.preview');assert.equal(h.inserted.length,0);assert.equal(h.preview().props.reply.media.fileName,'invitation.png');
 h.props.replies=[reply('one',{body:'Updated text',media:{...media,fileName:'updated.png'}})];h.render();assert.equal(h.preview().props.reply.body,'Updated text');
 h.preview().props.onInsert();h.render();assert.equal(h.inserted.length,1);assert.equal(h.inserted[0].media.fileName,'updated.png');assert.equal(h.preview(),undefined);
});
test('changing the target chat or deleting a reply closes the old preview',()=>{
 const h=harness();h.click('quickShelf.preview');h.props.contextKey='main:b';h.render();assert.equal(h.preview(),undefined);
 h.click('quickShelf.preview');h.props.replies=[];h.render();assert.equal(h.preview(),undefined);assert.equal(h.inserted.length,0);
});
test('blocked media insertion keeps the preview open and disabled chat cannot insert',()=>{
 const h=harness(QuickReplyBrowser,{onInsert:()=>false});h.click('quickShelf.preview');h.preview().props.onInsert();h.render();assert.ok(h.preview());
 h.props.disabled=true;h.render();h.find('quickShelf.insert').props.onClick();assert.equal(h.inserted.length,0);assert.ok(h.find('quickShelf.chooseChat'));
});
test('a media-only reply remains insertable and carries its attachment',()=>{
 const h=harness(QuickReplyBrowser,{replies:[reply('one',{body:'',media})]});h.click('quickShelf.insert');assert.equal(h.inserted[0].body,'');assert.equal(h.inserted[0].media.dataUrl,media.dataUrl);
});

test('pinned replies lead the complete list; pinned and recent views still respect search and category',()=>{
 const replies=[reply('a'),reply('b',{category:'opening'}),reply('c')];const pinned=[];
 const h=harness(QuickReplyBrowser,{replies,pinnedIds:['c'],recentIds:['b','c','missing'],onTogglePin:id=>pinned.push(id)});
 const titles=()=>h.nodes().filter(n=>n.type==='h4').map(n=>n.props.children);
 assert.deepEqual(titles(),['Reply c','Reply a','Reply b']);assert.deepEqual(replies.map(r=>r.id),['a','b','c']);
 h.click('quickShelf.unpin'+JSON.stringify({title:'Reply c'}));assert.deepEqual(pinned,['c']);
 h.click('quickShelf.view.pinned');assert.deepEqual(titles(),['Reply c']);
 h.click('quickShelf.view.recent');assert.deepEqual(titles(),['Reply b','Reply c']);
 h.find('multi.quickReplyCategories').props.onChange({target:{value:'opening'}});h.render();assert.deepEqual(titles(),['Reply b']);
 h.find('multi.searchQuickReplies').props.onChange({target:{value:'missing'}});h.render();assert.deepEqual(titles(),[]);
});

test('previewing and refused insertion do not update recents; successful insertion records one use',()=>{
 const used=[];let accepted=false;const h=harness(QuickReplyBrowser,{onInsert:()=>accepted,onUsed:id=>used.push(id)});
 h.click('quickShelf.view.recent');assert.ok(h.find('quickShelf.empty.recent'));h.click('quickShelf.view.all');
 h.click('quickShelf.preview');assert.deepEqual(used,[]);h.preview().props.onInsert();h.render();assert.deepEqual(used,[]);
 accepted=true;h.preview().props.onInsert();h.render();assert.deepEqual(used,['one']);assert.equal(h.preview(),undefined);
 h.props.disabled=true;h.render();h.click('quickShelf.insert');assert.deepEqual(used,['one']);
});

test('preview carries the current target chat and sending identity; account changes hide the old preview',()=>{
 const target={title:'Grace',account:'2: Alexandre'};const h=harness(QuickReplyBrowser,{target});
 h.click('quickShelf.preview');assert.deepEqual(h.preview().props.target,target);
 h.props.contextKey='main:a:account-b';h.render();assert.equal(h.preview(),undefined);
 const original=globalThis.document;globalThis.document={body:{}};
 try{
 const p=harness(QuickReplyPreview,{reply:reply('one'),category:'Other',target,disabled:false,onInsert(){},onClose(){}});
 assert.ok(p.find('quickShelf.target'+JSON.stringify({title:'Grace'})));assert.ok(p.find('quickShelf.account'+JSON.stringify({account:'2: Alexandre'})));
 }finally{globalThis.document=original;}
});

test('multi-window shelf labels the chat owner instead of the globally active account and shares pin/history actions',()=>{
 const state={settings:{quickReplies:[reply('a')],quickReplyCustomCategories:[],quickReplyPinnedIds:['a'],quickReplyRecentIds:['a'],sendChannel:'baileys',activeAccountId:'wa-a',liveBaileysAccountId:'wa-a',waAccounts:[{id:'wa-a',label:'1',userName:'Alice',status:'connected'},{id:'wa-b',label:'2',userName:'Bob',status:'connected'}]},chats:[{id:'chat-b',contactId:'b',contactName:'Grace',accountId:'wa-b',phoneId:'phone-b'}],contacts:[{id:'b'}],phones:[{id:'phone-b',name:'Pixel'}],baileysUi:{connection:'connected'},toggleQuickReplyPin(){},recordQuickReplyUsage(){},pushToast(){}};
 globalThis.shelfState=state;const picked=[];const h=harness(MultiWindowQuickReplies,{chatId:'chat-b',onPick:text=>picked.push(text)});
 const browser=()=>h.nodes().find(n=>n.type===QuickReplyBrowser).props;
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
 const rendered=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {QuickReplyBrowser} from './src/components/chat/QuickReplyBrowser.tsx';export const render=props=>renderToStaticMarkup(React.createElement(QuickReplyBrowser,props));`,resolveDir:root},bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',alias:{'@':root+'src'},banner:{js:`import {createRequire} from 'node:module';const require=createRequire(${JSON.stringify(new URL('../package.json',import.meta.url).href)});`},plugins:[{name:'shelf-translations',setup(b){b.onResolve({filter:/^@\/i18n$/},()=>({path:'i18n',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:translations}));}}]});
 const {render}=await import('data:text/javascript;base64,'+Buffer.from(rendered.outputFiles[0].text+'\n//# sourceURL=quick-shelf-ssr-test.js').toString('base64'));
 const replies=Array.from({length:1000},(_,i)=>reply(String(i),{body:'<script>alert(1)</script>',media:{...media,kind:['image','audio','video','file'][i%4]}}));
 const html=render({replies,contextKey:'main:a',onInsert(){}});assert.equal((html.match(/<article/g)||[]).length,50);assert.match(html,/loading="lazy"/);assert.match(html,/decoding="async"/);assert.doesNotMatch(html,/<audio|<video|<script/);assert.match(html,/&lt;script&gt;/);
});
