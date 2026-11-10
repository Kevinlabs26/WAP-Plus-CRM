import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const entry=fileURLToPath(new URL('../src/components/settings/SettingsDataPanel.tsx',import.meta.url));
const source=await readFile(entry,'utf8');
const modules=new Map([...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)].map(([,names,path])=>[path,names.split(',').map(name=>name.trim()).filter(name=>name&&!name.startsWith('type '))]));
const bundle=await build({entryPoints:[entry],bundle:true,format:'esm',platform:'browser',jsx:'automatic',write:false,plugins:[{name:'panel-boundaries',setup(b){
 b.onResolve({filter:/.*/},args=>args.kind==='entry-point'?undefined:{path:args.path,namespace:'mock'});
 b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='react/jsx-runtime'
  ?'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";'
  :(modules.get(args.path)||[]).map(name=>name==='useAppStore'
   ?'export const useAppStore=Object.assign((...args)=>globalThis.portableUi.useAppStore(...args),{getState:()=>globalThis.portableUi.useAppStore.getState()});'
   :`export const ${name}=(...args)=>globalThis.portableUi[${JSON.stringify(name)}]?.(...args);`).join('\n')}));
}}]});
const {SettingsDataPanel}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text+'\n//# sourceURL=portable-backup-ui.js').toString('base64'));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree?.props?[tree,...nodes(tree.props.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree?.props?text(tree.props.children):typeof tree==='string'?tree:'';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const cells=[],calls=[];let index=0;
 const state={settings:{},chats:[],contacts:[],selectedChatId:null,
  pushToast:(...args)=>calls.push(['toast',...args]),
  requestConfirm:async()=>{calls.push(['confirm']);return f.confirm;},
  importBackup:async value=>{calls.push(['restore',value]);return{ok:true};},
 };
 const store=selector=>selector(state);store.getState=()=>state;
 const bundle={version:2,contacts:[{id:'person'}],messages:[]};
 const f={calls,confirm:true,decryptError:false,bundle,
  render(){index=0;return SettingsDataPanel();},
  button(key){const node=nodes(f.render()).filter(node=>text(node)===key&&typeof node.props.onClick==='function').at(-1);assert.ok(node,key);return node.props;},
  changePassword(password){for(const node of nodes(f.render()).filter(node=>node.type==='input'&&node.props.type==='password'))node.props.onChange({target:{value:password}});},
  choose(){nodes(f.render()).find(node=>node.type==='input'&&node.props.accept==='.wapbackup').props.onChange({target:{files:[{name:'test.wapbackup'}],value:'selected'}});},
 };
 globalThis.localStorage={getItem:()=>null,setItem(){}};
 globalThis.portableUi={useAppStore:store,useI18n:()=>({t:key=>key}),isTauri:()=>false,
  flushPersist:async get=>{assert.equal(get(),state);calls.push(['save']);await f.saveWait;if(f.saveError)throw Error('disk full');},
  useState(initial){const i=index++;cells[i]??={value:typeof initial==='function'?initial():initial};return[cells[i].value,value=>{cells[i].value=typeof value==='function'?value(cells[i].value):value;}];},
  useRef(initial){return cells[index++]??={current:initial};},useEffect(){},useMemo:fn=>fn(),findInactiveChats:()=>[],
  createBackupBundle:async(...args)=>{calls.push(['snapshot',...args]);return{bundle};},
  encryptPortableBackup:async(value,password)=>{calls.push(['encrypt',value,password]);return new Blob(['encrypted']);},
  downloadPortableBackup:blob=>calls.push(['download',blob]),
  decryptPortableBackup:async(file,password)=>{calls.push(['decrypt',file,password]);if(f.decryptError)throw Error('wrong password');return bundle;},
  parseBackupJson:value=>{calls.push(['preview']);return value;},
 };
 return f;
}

test('portable export requires matching passwords and encrypts the full snapshot before downloading',async()=>{
 const f=fixture();f.button('backup.portableExport').onClick();
 assert.equal(f.button('backup.portableExport').disabled,true);
 f.changePassword('long test password');assert.equal(f.button('backup.portableExport').disabled,false);
 f.button('backup.portableExport').onClick();await tick();
 assert.deepEqual(f.calls.filter(([name])=>['save','snapshot','encrypt','download'].includes(name)).map(([name])=>name),['save','snapshot','encrypt','download']);
 assert.equal(f.calls.find(([name])=>name==='snapshot')[2],false);
 assert.equal(f.calls.find(([name])=>name==='encrypt')[2],'long test password');
 assert.equal(nodes(f.render()).some(node=>node.props.type==='password'),false);
});

test('portable export waits for pending deletions and never downloads after a failed save',async()=>{
 const f=fixture();let finish;
 f.saveWait=new Promise(resolve=>{finish=resolve;});
 f.button('backup.portableExport').onClick();f.changePassword('long test password');f.button('backup.portableExport').onClick();await tick();
 assert.equal(f.calls.some(([name])=>name==='snapshot'),false);
 f.bundle.messages=[];finish();await tick();
 assert.deepEqual(f.calls.find(([name])=>name==='encrypt')[1].messages,[]);
 const failed=fixture();failed.saveError=true;failed.button('backup.portableExport').onClick();failed.changePassword('long test password');failed.button('backup.portableExport').onClick();await tick();
 assert.equal(failed.calls.some(([name])=>['snapshot','encrypt','download'].includes(name)),false);
 assert.ok(failed.calls.some(([name,message])=>name==='toast'&&message.includes('disk full')));
});

test('portable import never writes on a wrong password or cancelled preview, and confirms before restoring',async()=>{
 const f=fixture();f.choose();f.changePassword('long test password');f.decryptError=true;
 f.button('backup.portableImport').onClick();await tick();
 assert.equal(f.calls.some(([name])=>name==='preview'||name==='confirm'||name==='restore'),false);
 assert.equal(nodes(f.render()).find(node=>node.props.type==='password').props.value,'');
 f.decryptError=false;f.confirm=false;f.changePassword('long test password');f.button('backup.portableImport').onClick();await tick();
 assert.equal(f.calls.some(([name])=>name==='restore'),false);
 f.confirm=true;f.changePassword('long test password');f.button('backup.portableImport').onClick();await tick();
 assert.deepEqual(f.calls.filter(([name])=>['decrypt','preview','confirm','restore'].includes(name)).slice(-4).map(([name])=>name),['decrypt','preview','confirm','restore']);
 assert.equal(nodes(f.render()).some(node=>node.props.type==='password'),false);
});
