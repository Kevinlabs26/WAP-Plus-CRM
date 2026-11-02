import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { translate } from '../src/i18n/core.ts';

const mocks={
 react:'export const useState=v=>globalThis.folderMenuHooks.state(v);export const useRef=v=>globalThis.folderMenuHooks.ref(v);export const useEffect=(f,d)=>globalThis.folderMenuHooks.effect(f,d);',
 'react-dom':'export const createPortal=children=>children;',
 'react/jsx-runtime':'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;',
 'lucide-react':['Clock3', 'Check','Copy','ChevronDown','ChevronRight','Folder','FolderPlus','Link2','GripVertical','LayoutGrid','MoreHorizontal','Pencil','Trash2','Upload','Users','UserRoundX'].map(n=>`export const ${n}="${n}";`).join(''),
 '@/i18n':'export const useI18n=()=>({t:(k,p)=>globalThis.folderMenuTranslate(k,p)});',
};
const built=await build({entryPoints:[fileURLToPath(new URL('../src/components/layout/FolderHeaderRow.tsx',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',
 alias:{'@':fileURLToPath(new URL('../src',import.meta.url))},plugins:[{name:'folder-menu-boundaries',setup(b){
 b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {FolderHeaderRow}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text+'\n//# sourceURL=folder-menu-tests.js').toString('base64'));
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t?.props?[t,...nodes(t.props.children)]:[];

function fixture(mode,rect={left:700,right:940,top:650,bottom:682}) {
 const original={window:globalThis.window,document:globalThis.document,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
 const cells=[],effects=[],listeners=new Map(),elements=new Map(),changes=[],timers=new Map();let index=0,tree,timerId=0;
 globalThis.setTimeout=fn=>{timers.set(++timerId,fn);return timerId;};globalThis.clearTimeout=id=>timers.delete(id);
 globalThis.document={body:{},activeElement:null};
 globalThis.window={innerWidth:1000,innerHeight:720,
  addEventListener(name,fn){const items=listeners.get(name)||new Set();items.add(fn);listeners.set(name,items);},
  removeEventListener(name,fn){listeners.get(name)?.delete(fn);}};
 globalThis.folderMenuTranslate=(key,params)=>translate('zh-CN',key,params);
 globalThis.folderMenuHooks={
  state(v){const n=index++;cells[n]??={value:v};return[cells[n].value,value=>{cells[n].value=value;}];},
  ref(v){return cells[index++]??={current:v};},
  effect(fn,deps){const n=index++,old=cells[n];if(!old||!deps.every((v,i)=>Object.is(v,old.deps[i]))){
   cells[n]={deps,cleanup:old?.cleanup};effects.push(()=>{cells[n].cleanup?.();cells[n].cleanup=fn();});}},
 };
 const props={folderId:'f',name:'Folder',collapsed:true,depth:2,total:4,unread:1,autoReplyMode:mode,onToggle(){},onAutoReplyModeChange:value=>{changes.push(value);props.autoReplyMode=value;}};
 const ui={props,changes,listeners,
  render(){index=0;tree=FolderHeaderRow(props);const list=nodes(tree);
   for(const node of list){if(!node.props.ref)continue;let el=elements.get(node.props.ref);
    if(!el){el={focus(){document.activeElement=this;},getBoundingClientRect:()=>rect};elements.set(node.props.ref,el);}
    el.node=node;node.props.ref.current=el;
    el.querySelectorAll=selector=>nodes(el.node).filter(n=>n!==el.node&&n.props.role===(selector.includes('menuitemradio')?'menuitemradio':'menuitem')).map(n=>ui.element(n));
    el.querySelector=selector=>{const selected=nodes(el.node).find(n=>selector.includes('aria-checked')?n.props.role==='menuitemradio'&&n.props['aria-checked']:n.props.role==='menuitem');return selected?ui.element(selected):null;};
   }
   while(effects.length)effects.shift()();return list;
  },
  element(node){let el=elements.get(node);if(!el){el={node,focus(){document.activeElement=this;},getBoundingClientRect:()=>rect};elements.set(node,el);}return node.props.ref?.current||el;},
  get tree(){return nodes(tree);},
  get root(){return this.tree.find(n=>n.props.role==='menu'&&!n.props.id);},
  get submenu(){return this.tree.find(n=>n.props.id==='folder-reply-f');},
  get trigger(){return this.tree.find(n=>n.props.role==='menuitem'&&n.props['aria-haspopup']==='menu');},
  event(node,extra={}){return{currentTarget:this.element(node),preventDefault(){},stopPropagation(){},...extra};},
  open(){const row=this.tree.find(n=>n.props['data-chat-folder-drop']==='f');row.props.onContextMenu({clientX:rect.left,clientY:rect.top,preventDefault(){}});this.render();},
  expand(){this.trigger.props.onClick(this.event(this.trigger));this.render();},
  key(node,key){node.props.onKeyDown(this.event(node,{key}));this.render();},
  dispatch(name,event={}){for(const fn of [...listeners.get(name)||[]])fn(event);this.render();},
  finishClose(){for(const [id,fn]of [...timers]){timers.delete(id);fn();}this.render();},
  close(){cells.forEach(c=>c?.cleanup?.());Object.assign(globalThis,original);delete globalThis.folderMenuHooks;delete globalThis.folderMenuTranslate;},
 };
 ui.render();return ui;
}

test('reply settings are only in a submenu, preserve the selected rule and apply each option once',()=>{
 for(const initial of [undefined,'auto','manual']) {
  const ui=fixture(initial);try {
   assert.equal(ui.tree.some(n=>n.type==='select'||n.props.role==='menu'),false);
   ui.open();assert.ok(ui.trigger);assert.equal(ui.submenu,undefined);
   ui.expand();
   const options=ui.tree.filter(n=>n.props.role==='menuitemradio');assert.equal(options.length,3);
   assert.equal(options.findIndex(n=>n.props['aria-checked']),[undefined,'auto','manual'].indexOf(initial));
   assert.ok(options.every(n=>n.props['aria-checked']===true||n.props['aria-checked']===false));
   assert.ok(ui.tree.some(n=>typeof n.props.children==='string'&&n.props.children.includes('个人设置优先')));
   options[1].props.onClick();ui.render();assert.deepEqual(ui.changes,['auto']);assert.equal(ui.root,undefined);
   ui.open();ui.expand();ui.tree.filter(n=>n.props.role==='menuitemradio')[2].props.onClick();ui.render();
   ui.open();ui.expand();ui.tree.filter(n=>n.props.role==='menuitemradio')[0].props.onClick();ui.render();
   assert.deepEqual(ui.changes,['auto','manual',undefined]);
  }finally{ui.close();}
 }
});

test('submenu flips at the right edge and stays vertically inside the viewport',()=>{
 const ui=fixture();try{ui.open();ui.expand();assert.equal(ui.submenu.props.style.left,474);assert.equal(ui.submenu.props.style.top,536);}finally{ui.close();}
 const left=fixture('manual',{left:20,right:260,top:40,bottom:72});try{left.open();left.expand();assert.equal(left.submenu.props.style.left,262);assert.equal(left.submenu.props.style.top,40);}finally{left.close();}
});

test('hover then click keeps the submenu open; keyboard navigation returns focus and closes one menu level at a time',()=>{
 const ui=fixture('auto');try {
  ui.open();ui.trigger.props.onMouseEnter(ui.event(ui.trigger));ui.render();ui.expand();assert.ok(ui.submenu);
  assert.equal(document.activeElement.node.props['aria-checked'],true);
  ui.key(ui.submenu,'ArrowDown');assert.ok(document.activeElement.node.props.children.includes('仅人工'));
  ui.key(ui.submenu,'Home');assert.ok(document.activeElement.node.props.children.includes('继承父级 / 默认'));
  ui.key(ui.submenu,'End');assert.ok(document.activeElement.node.props.children.includes('仅人工'));
  ui.key(ui.submenu,'ArrowLeft');assert.equal(ui.submenu,undefined);assert.ok(ui.root);
  assert.equal(document.activeElement.node.props['aria-haspopup'],'menu');
  ui.key(ui.trigger,'ArrowRight');assert.ok(ui.submenu);
  ui.key(ui.submenu,'Escape');assert.equal(ui.submenu,undefined);assert.ok(ui.root);
  ui.dispatch('keydown',{key:'Escape',preventDefault(){}});assert.equal(ui.root,undefined);
 }finally{ui.close();}
});

test('outside clicks, another folder menu, window blur and viewport changes dismiss the menu without changing rules',()=>{
 const ui=fixture();try {
  for(const action of ['outside','other-folder','scroll','resize','blur']) {
   ui.open();ui.expand();
   if(['scroll','resize','blur'].includes(action))ui.dispatch(action,{target:{closest:()=>null}});
   else ui.dispatch('pointerdown',{target:{closest:()=>action==='outside'?null:{dataset:{folderActionMenu:'other'}}}});
   assert.equal(ui.root,undefined);assert.equal(ui.submenu,undefined);assert.deepEqual(ui.changes,[]);
  }
 }finally{ui.close();}
});

test('folder schedule action opens once and closes the menu while retaining viewport space',()=>{
 const ui=fixture();let opened=0;ui.props.onSchedule=()=>opened++;
 try{
 ui.render();ui.open();
 const action=ui.tree.find(n=>n.props.role==='menuitem'&&Array.isArray(n.props.children)&&n.props.children.includes('新建定时计划'));
 assert.ok(action);assert.ok(ui.root.props.style.maxHeight<=window.innerHeight-ui.root.props.style.top);
 action.props.onClick();ui.render();assert.equal(opened,1);assert.equal(ui.root,undefined);
 }finally{ui.close();}
});

test('import actions expand on demand and close the folder menu after running once',()=>{
 const ui=fixture();let imported=0;ui.props.onImport=()=>imported++;
 const action=label=>ui.tree.find(n=>n.props.role==='menuitem'&&nodes(n).some(child=>child.props.children===label||Array.isArray(child.props.children)&&child.props.children.includes(label)));
 try{
  ui.render();ui.open();assert.equal(action('导入号码'),undefined);
  const trigger=action('导入与添加');trigger.props.onClick(ui.event(trigger));ui.render();assert.ok(action('导入号码'));
  action('导入号码').props.onClick();ui.render();assert.equal(imported,1);assert.equal(ui.root,undefined);
  ui.open();assert.equal(action('导入号码'),undefined);
 }finally{ui.close();}
});

test('folder bulk send and scheduled send are separate actions and each closes the context menu',()=>{
 const ui=fixture();let bulk=0,scheduled=0;ui.props.onBroadcast=()=>bulk++;ui.props.onSchedule=()=>scheduled++;
 try{
 ui.render();ui.open();
 const action=label=>ui.tree.find(n=>n.props.role==='menuitem'&&Array.isArray(n.props.children)&&n.props.children.includes(label));
 assert.ok(action('群发给此文件夹'));assert.ok(action('新建定时计划'));
 action('群发给此文件夹').props.onClick();ui.render();assert.equal(bulk,1);assert.equal(scheduled,0);assert.equal(ui.root,undefined);
 ui.open();action('新建定时计划').props.onClick();ui.render();assert.equal(bulk,1);assert.equal(scheduled,1);assert.equal(ui.root,undefined);
 }finally{ui.close();}
});

const item=(ui,label)=>ui.tree.find(n=>n.props.role==='menuitem'&&nodes(n).some(child=>child.props.children===label||Array.isArray(child.props.children)&&child.props.children.includes(label)));
for(const [kind,label,first,last] of [['import','导入与添加','导入号码','选择已加入的群组'],['organize','整理文件夹','新建子分组','清空分组成员']]){
 test(`${kind} opens a side submenu on hover and stays open while crossing the pointer gap`,()=>{
  const ui=fixture();try{
   ui.open();const trigger=item(ui,label);trigger.props.onMouseEnter(ui.event(trigger));ui.render();
   const popup=()=>ui.tree.find(n=>n.props.id===`folder-${kind}-f`);
   assert.ok(popup());assert.equal(item(ui,label).props['aria-expanded'],true);
   assert.equal(popup().props.style.left,474);assert.ok(popup().props.style.top+112<=window.innerHeight);
   assert.ok(item(ui,first));assert.equal(nodes(ui.root).some(n=>n===item(ui,first)),false,'actions are outside the parent menu, not an inline accordion');
   ui.root.props.onMouseLeave();popup().props.onMouseEnter();ui.finishClose();assert.ok(popup());
   popup().props.onMouseLeave();ui.finishClose();assert.equal(popup(),undefined);assert.ok(ui.root);
  }finally{ui.close();}
 });
 test(`${kind} keyboard navigation enters the submenu and returns focus to its own trigger`,()=>{
  const ui=fixture(undefined,{left:20,right:260,top:40,bottom:72});try{
   ui.open();ui.key(item(ui,label),'ArrowRight');const popup=()=>ui.tree.find(n=>n.props.id===`folder-${kind}-f`);
   assert.equal(popup().props.style.left,262);assert.ok(document.activeElement.node.props.children.includes(first));
   ui.key(popup(),'End');assert.ok(document.activeElement.node.props.children.includes(last));
   ui.key(popup(),'Home');assert.ok(document.activeElement.node.props.children.includes(first));
   ui.key(popup(),'ArrowLeft');assert.equal(popup(),undefined);assert.equal(document.activeElement,item(ui,label).props.ref.current);
   ui.key(item(ui,label),'Enter');assert.ok(popup());ui.key(popup(),'Escape');assert.equal(popup(),undefined);assert.ok(ui.root);
  }finally{ui.close();}
 });
}

test('hovering another submenu switches it; hovering a regular action closes it; actions fire once',()=>{
 const ui=fixture();let renamed=0;ui.props.onRename=()=>renamed++;
 try{
  ui.open();const hover=label=>{const trigger=item(ui,label);trigger.props.onMouseEnter(ui.event(trigger));ui.render();};
  hover('导入与添加');hover('整理文件夹');assert.equal(item(ui,'导入号码'),undefined);assert.ok(item(ui,'重命名'));
  item(ui,'重命名').props.onClick();ui.render();assert.equal(renamed,1);assert.equal(ui.root,undefined);
  ui.open();hover('导入与添加');ui.trigger.props.onMouseEnter(ui.event(ui.trigger));ui.render();assert.ok(ui.submenu);assert.equal(item(ui,'导入号码'),undefined);
  ui.root.props.onMouseOver({target:{closest:()=>({hasAttribute:()=>false})}});ui.render();assert.equal(ui.submenu,undefined);assert.ok(ui.root);
 }finally{ui.close();}
});

test('copying never-replied numbers is an organize action and closes the menu after one click',()=>{
 const ui=fixture();let copied=0;ui.props.onCopyUnreplied=()=>copied++;
 try{
  ui.render();ui.open();const trigger=item(ui,'整理文件夹');trigger.props.onMouseEnter(ui.event(trigger));ui.render();
  const popup=ui.tree.find(n=>n.props.id==='folder-organize-f');assert.ok(popup.props.style.top+144<=window.innerHeight);
  item(ui,'复制从未回复的号码').props.onClick();ui.render();assert.equal(copied,1);assert.equal(ui.root,undefined);
 }finally{ui.close();}
});
