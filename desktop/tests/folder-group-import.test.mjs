import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

const mocks={
 react:'export const useMemo=f=>f();export const useState=i=>globalThis.importHooks.state(i);',
 'react/jsx-runtime':'export const Fragment="fragment";export const jsx=(type,props)=>({type,props});export const jsxs=jsx;',
 'lucide-react':'export const Check="icon",LoaderCircle="loader",Search="icon",Users="icon";',
 '@/store/appStore':'export const useAppStore={getState:()=>({pushToast:(...args)=>globalThis.importToasts.push(args)})};',
 '@/i18n':'export const useI18n=()=>({t:(key,params)=>key+(params?JSON.stringify(params):"")});',
 '@/lib/baileysGroups':'export const baileysGroupInviteInfo=async()=>({ok:true,invite:{jid:"12345@g.us",subject:"Example"}});export const baileysGroupAcceptInvite=async(...args)=>{globalThis.importRequests.push(args);return {ok:true,groupJid:"12345@g.us"};};',
};
const built=await build({stdin:{contents:"export {FolderGroupImportDialog} from './src/components/layout/FolderGroupImportDialog.tsx';",resolveDir:fileURLToPath(new URL('../',import.meta.url))},bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',alias:{'@':fileURLToPath(new URL('../src',import.meta.url))},plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {FolderGroupImportDialog}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t?.props?[t,...nodes(t.props.children)]:[];
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};

for(const fail of [false,true])test(`invite filing awaits local sync and reports ${fail?'failure':'success'} only after it finishes`,async()=>{
 let resolve,reject,cursor=0,slots=[],tree,joined;
 const pending=new Promise((yes,no)=>{resolve=yes;reject=no;});
 globalThis.importToasts=[];globalThis.importRequests=[];
 globalThis.importHooks={state(initial){const at=cursor++;if(!(at in slots))slots[at]=typeof initial==='function'?initial():initial;return [slots[at],value=>{slots[at]=typeof value==='function'?value(slots[at]):value;}];}};
 const props={mode:'links',folderName:'Folder',groups:[],accounts:[{id:'a'}],connectedAccountIds:['a'],existingGroupChatIds:{},initialAccountId:'a',accountLabelOf:id=>id,onClose(){},onMoveGroups(){},onAlreadyJoined(){},onJoined(...args){joined=args;return pending;}};
 const render=()=>{cursor=0;tree=FolderGroupImportDialog(props);};
 const button=key=>nodes(tree).find(n=>n.type==='button'&&(Array.isArray(n.props.children)?n.props.children:[n.props.children]).some(child=>typeof child==='string'&&child.startsWith(key)));
 render();nodes(tree).find(n=>n.type==='textarea').props.onChange({target:{value:'https://chat.whatsapp.com/Abcdefgh12345678'}});render();
 button('folderGroups.preview').props.onClick();await flush();render();
 button('folderGroups.joinAndMove').props.onClick();await flush();render();
 assert.deepEqual(globalThis.importRequests,[['https://chat.whatsapp.com/Abcdefgh12345678','a']]);
 assert.equal(joined[0],'12345@g.us');assert.equal(joined[2],'a');assert.equal(globalThis.importToasts.length,0);
 assert.equal(nodes(tree).find(n=>n.type==='textarea').props.disabled,true,'keeps account and input locked until sync completes');
 if(fail)reject(Error('local sync failed'));else resolve();await flush();render();
 assert.equal(nodes(tree).find(n=>n.type==='textarea').props.disabled,false);
 assert.equal(globalThis.importToasts.length,1);
 const summary=globalThis.importToasts[0][0];assert.ok(summary.includes(`"joined":${fail?0:1}`));assert.ok(summary.includes(`"failed":${fail?1:0}`));
 if(fail)assert.ok(nodes(tree).some(n=>n.props.children==='local sync failed'));
});
