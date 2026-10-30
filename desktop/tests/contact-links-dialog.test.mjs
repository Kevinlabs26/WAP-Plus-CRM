import assert from 'node:assert/strict';
import test from 'node:test';
import { build, transform } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { translate } from '../src/i18n/core.ts';
import { MAX_CHAT_DRAFT_LENGTH } from '../src/lib/chatDrafts.ts';
const mocks = {
 react: 'export const useState=v=>globalThis.linksHooks.state(v);export const useRef=v=>globalThis.linksHooks.ref(v);export const useMemo=f=>f();export const useEffect=()=>{};',
 'react/jsx-runtime': 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";',
 'lucide-react': 'export const Link2="icon",X="icon";',
 '@/components/ui/primitives': 'export const Button="button",Input="input",Textarea="textarea";',
 '@/i18n': 'export const useI18n=()=>({t:(k,p)=>globalThis.linksTranslate(k,p)});',
 '@/lib/exportData': 'export const downloadText=(...args)=>globalThis.linksDownloads.push(args);',
};
const built = await build({entryPoints:[fileURLToPath(new URL('../src/components/chat/ContactLinksDialog.tsx',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',alias:{'@':fileURLToPath(new URL('../src',import.meta.url))},plugins:[{name:'links-ui',setup(b){
 b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {ContactLinksDialog} = await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t?.props?[t,...nodes(t.props.children)]:[];
const text=t=>Array.isArray(t)?t.map(text).join(''):t?.props?text(t.props.children):typeof t==='string'?t:'';
const button=(tree,label)=>tree.find(n=>n.type==='button'&&text(n)===label);
const change=(node,value)=>node.props.onChange({target:{value}});
function fixture(){
 const cells=[],inserted=[],downloads=[];let index=0,closed=0;
 globalThis.linksHooks={state(v){const n=index++;cells[n]??={value:v};return[cells[n].value,v=>cells[n].value=v];},ref(v){return cells[index++]??={current:v};}};
 globalThis.linksTranslate=(k,p)=>translate('zh-CN',k,p);globalThis.linksDownloads=downloads;
 const props={onClose:()=>closed++,onInsert:value=>{inserted.push(value);return true;},canInsert:true};
 return {props,inserted,downloads,get closed(){return closed;},render(){index=0;return nodes(ContactLinksDialog(props));},close(){delete globalThis.linksHooks;delete globalThis.linksTranslate;delete globalThis.linksDownloads;}};
}

test('contact links preview, copy, CSV and confirmed draft insertion use the same generated results',async()=>{
 const ui=fixture();const prior=Object.getOwnPropertyDescriptor(globalThis,'navigator');let copied='';
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async value=>{copied=value;}}}});
 try{
  let tree=ui.render(),inputs=tree.filter(n=>n.type==='input'),areas=tree.filter(n=>n.type==='textarea');
  change(inputs[0],'Team');change(inputs[1],'33');change(inputs[2],'5');change(areas[0],'Bonjour & merci');change(areas[1],'Jean Exemple\t06 00 00 00 01\n+12025550102');
  tree=ui.render();assert.ok(text(tree).includes('5. Team Jean Exemple'));assert.ok(text(tree).includes('6. Team'));assert.deepEqual(ui.inserted,[]);
  await button(tree,'复制结果').props.onClick();assert.match(copied,/^5\. Team Jean Exemple\nhttps:\/\/wa.me\/33600000001\?text=Bonjour%20%26%20merci/);
  assert.ok(copied.includes('\n\n6. Team\nhttps://wa.me/12025550102'));
  button(tree,'导出 CSV').props.onClick();assert.equal(ui.downloads[0][0],'contact-links.csv');assert.match(ui.downloads[0][1],/"5\. Team Jean Exemple"/);assert.match(ui.downloads[0][1],/"6\. Team"/);
  assert.equal(ui.downloads[0][2],'text/csv;charset=utf-8');
  button(tree,'填入草稿').props.onClick();assert.deepEqual(ui.inserted,[copied]);assert.equal(ui.closed,1);
 }finally{ui.close();if(prior)Object.defineProperty(globalThis,'navigator',prior);else delete globalThis.navigator;}
});

test('bad rows and calling codes block results; unavailable drafts still allow export; rejected insertion keeps dialog open',()=>{
 const ui=fixture();try{
  let tree=ui.render();change(tree.filter(n=>n.type==='textarea')[1],'Good\t12025550101\nBad\t123');tree=ui.render();
  assert.equal(button(tree,'复制结果').props.disabled,true);assert.ok(tree.some(n=>n.props.role==='alert'));
  change(tree.filter(n=>n.type==='textarea')[1],'Good\t12025550101');change(tree.filter(n=>n.type==='input')[1],'999');tree=ui.render();assert.equal(button(tree,'复制结果').props.disabled,true);
  change(tree.filter(n=>n.type==='input')[1],'');ui.props.canInsert=false;tree=ui.render();
  assert.equal(button(tree,'填入草稿').props.disabled,true);assert.equal(button(tree,'复制结果').props.disabled,false);assert.equal(button(tree,'导出 CSV').props.disabled,false);
  ui.props.canInsert=true;ui.props.onInsert=()=>false;tree=ui.render();button(tree,'填入草稿').props.onClick();assert.equal(ui.closed,0);
  tree.find(n=>n.props.role==='dialog').props.onKeyDown({key:'Escape',preventDefault(){},stopPropagation(){}});assert.equal(ui.closed,1);
 }finally{ui.close();}
});

test('composer appends links without sending, preserves long drafts and blocks insertion while editing or attaching',async()=>{
 const source=readFileSync(new URL('../src/components/chat/Composer.tsx',import.meta.url),'utf8');
 const start=source.indexOf('{linksOpen && createPortal('),end=source.indexOf('\n      {vcfOpen &&',start);
 const markup=source.slice(start+1,end).trim().slice(0,-1);
 const code=await transform(`function render(scope){const {element,linksOpen,createPortal,ContactLinksDialog,resetKey,sendAccountId,setLinksOpen,textareaRef,sending,recording,inputLocked,editingId,pendingMedia,mediaSendingIndex,readDraft,MAX_CHAT_DRAFT_LENGTH,pushToast,t,flushDraftNow,applyDraftToDom,setTranslateOriginal,document}=scope;return ${markup};}`,{loader:'tsx',jsxFactory:'element'});
 const render=new Function(code.code+';return render;')();
 let draft='Original message',dom=draft,toast='',translation='before',closed=false;
 const scope={element:(type,props)=>({type,props}),linksOpen:true,createPortal:v=>v,ContactLinksDialog:'dialog',resetKey:'chat-a',sendAccountId:'account-a',setLinksOpen:v=>closed=!v,textareaRef:{current:null},sending:false,recording:false,inputLocked:false,editingId:null,pendingMedia:[],mediaSendingIndex:-1,readDraft:()=>draft,MAX_CHAT_DRAFT_LENGTH,pushToast:v=>toast=v,t:k=>k,flushDraftNow:v=>draft=v,applyDraftToDom:v=>dom=v,setTranslateOriginal:v=>translation=v,document:{body:{}}};
 let modal=render(scope);assert.equal(modal.props.key,'chat-a:account-a');assert.equal(modal.props.onInsert('Name\nhttps://wa.me/12025550101'),true);
 assert.equal(draft,'Original message\n\nName\nhttps://wa.me/12025550101');assert.equal(dom,draft);assert.equal(translation,null);
 draft='x'.repeat(MAX_CHAT_DRAFT_LENGTH);dom=draft;assert.equal(render(scope).props.onInsert('Name\nlink'),false);assert.equal(draft,dom);assert.equal(toast,'links.longDraft');
 for(const busy of [{sending:true},{recording:true},{inputLocked:true},{editingId:'message'},{pendingMedia:[{}]},{mediaSendingIndex:0}]){
  modal=render({...scope,...busy});assert.equal(modal.props.canInsert,false);assert.equal(modal.props.onInsert('text'),false);assert.equal(draft,dom);
 }
 modal.props.onClose();assert.equal(closed,true);
 assert.match(source,/setLinksOpen\(false\);.*\[resetKey, sendAccountId\]/);
});
