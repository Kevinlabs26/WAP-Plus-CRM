import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

const mocks={
 react:'export const useMemo=f=>f();export const useState=i=>globalThis.importHooks.state(i);export const useRef=i=>globalThis.importHooks.ref(i);',
 'react/jsx-runtime':'export const Fragment="fragment";export const jsx=(type,props)=>({type,props});export const jsxs=jsx;',
 'lucide-react':'export const Check="icon",LoaderCircle="loader",Search="icon",Users="icon";',
 '@/store/appStore':'export const useAppStore={getState:()=>({pushToast:(...args)=>globalThis.importToasts.push(args)})};',
 '@/i18n':'export const useI18n=()=>({t:(key,params)=>key+(params?JSON.stringify(params):"")});',
 '@/lib/baileysGroups':'export const baileysGroupInviteInfo=async(...args)=>{(globalThis.importPreviewRequests||=[]).push(args);return globalThis.importPreview?globalThis.importPreview(...args):{ok:true,invite:{jid:"12345@g.us",subject:"Example"}};};export const baileysGroupAcceptInvite=async(...args)=>{globalThis.importRequests.push(args);return globalThis.importAccept?globalThis.importAccept(...args):{ok:true,groupJid:"12345@g.us"};};',
};
const built=await build({stdin:{contents:"export {FolderGroupImportDialog} from './src/components/layout/FolderGroupImportDialog.tsx';",resolveDir:fileURLToPath(new URL('../',import.meta.url))},bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',alias:{'@':fileURLToPath(new URL('../src',import.meta.url))},plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {FolderGroupImportDialog}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t?.props?[t,...nodes(t.props.children)]:[];
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};

for(const fail of [false,true])test(`invite filing awaits local sync and reports ${fail?'failure':'success'} only after it finishes`,async()=>{
 let resolve,reject,cursor=0,slots=[],tree,joined;
 const pending=new Promise((yes,no)=>{resolve=yes;reject=no;});
 globalThis.importToasts=[];globalThis.importRequests=[];
 globalThis.importHooks={state(initial){const at=cursor++;if(!(at in slots))slots[at]=typeof initial==='function'?initial():initial;return [slots[at],value=>{slots[at]=typeof value==='function'?value(slots[at]):value;}];},ref(initial){return slots[cursor++]??={current:initial};}};
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

function fixture(){
 let cursor=0;const slots=[],filed=[],already=[];
 globalThis.importToasts=[];globalThis.importRequests=[];globalThis.importPreviewRequests=[];globalThis.importPreview=undefined;globalThis.importAccept=undefined;
 globalThis.importHooks={state(initial){const at=cursor++;if(!(at in slots))slots[at]=typeof initial==='function'?initial():initial;return[slots[at],value=>{slots[at]=typeof value==='function'?value(slots[at]):value;}];},ref(initial){return slots[cursor++]??={current:initial};}};
 const f={filed,already,failFiling:false,fileGate:undefined,
  props:{mode:'links',folderName:'Target',groups:[],accounts:[{id:'a'}],connectedAccountIds:['a'],existingGroupChatIds:{},initialAccountId:'a',accountLabelOf:id=>id,onClose(){},onMoveGroups(){},
   async onJoined(...args){filed.push(args);await f.fileGate;if(f.failFiling)throw Error('local save failed');},
   async onAlreadyJoined(id){already.push(id);await f.fileGate;if(f.failFiling)throw Error('local save failed');}},
  render(){cursor=0;return FolderGroupImportDialog(f.props);},
  button(key){return nodes(f.render()).find(node=>node.type==='button'&&(Array.isArray(node.props.children)?node.props.children:[node.props.children]).some(child=>typeof child==='string'&&child.startsWith(key))).props;},
  paste(){nodes(f.render()).find(node=>node.type==='textarea').props.onChange({target:{value:'https://chat.whatsapp.com/Abcdefgh12345678'}});},
 };
 return f;
}

test('a single import click reads the preview, joins and files in the selected account; double clicks never duplicate joins',async()=>{
 const f=fixture();f.paste();const button=f.button('folderGroups.joinAndMove');assert.equal(button.disabled,false);
 button.onClick();button.onClick();await flush();
 assert.equal(globalThis.importPreviewRequests.length,1);assert.deepEqual(globalThis.importRequests,[['https://chat.whatsapp.com/Abcdefgh12345678','a']]);
 assert.equal(f.filed.length,1);assert.equal(f.filed[0][1].subject,'Example');assert.equal(f.filed[0][2],'a');
 assert.equal(globalThis.importToasts.length,1);assert.match(globalThis.importToasts[0][0],/"joined":1/);
});

test('preview remains read only and losing the account connection disables importing',async()=>{
 const f=fixture();f.paste();f.button('folderGroups.preview').onClick();await flush();
 assert.equal(globalThis.importRequests.length,0);assert.equal(f.filed.length,0);
 f.props.connectedAccountIds=[];const button=f.button('folderGroups.joinAndMove');assert.equal(button.disabled,true);
 button.onClick();await flush();assert.equal(globalThis.importRequests.length,0);
});

test('preview finds an existing group on another account and files that chat instead of joining again',async()=>{
 const f=fixture();f.props.existingGroupChatIds={'other|12345@g.us':'existing-chat'};f.paste();
 f.button('folderGroups.preview').onClick();await flush();
 assert.equal(globalThis.importRequests.length,0);
 assert.ok(nodes(f.render()).some(node=>String(node.props.children||'').includes('folderGroups.alreadyInAccount')));
 f.button('folderGroups.joinAndMove').onClick();await flush();
 assert.deepEqual(f.already,['existing-chat']);assert.equal(globalThis.importRequests.length,0);
});

test('an account-scoped folder blocks joining from a different account when group membership already exists elsewhere',async()=>{
 const f=fixture();f.props.fixedAccountId='a';f.props.existingGroupChatIds={'other|12345@g.us':'existing-chat'};f.paste();
 f.button('folderGroups.preview').onClick();await flush();
 f.button('folderGroups.joinAndMove').onClick();await flush();
 assert.deepEqual(f.already,[]);assert.equal(globalThis.importRequests.length,0);
 assert.ok(nodes(f.render()).some(node=>String(node.props.children||'').includes('folderGroups.groupInOtherAccount')));
});

test('retrying failed local filing uses the confirmed group instead of joining WhatsApp again',async()=>{
 const f=fixture();f.failFiling=true;f.paste();f.button('folderGroups.joinAndMove').onClick();await flush();
 assert.equal(globalThis.importRequests.length,1);assert.match(globalThis.importToasts[0][0],/"failed":1/);
 f.failFiling=false;f.button('folderGroups.retryFailed').onClick();await flush();
 assert.equal(globalThis.importRequests.length,1);assert.equal(f.filed.length,2);assert.match(globalThis.importToasts.at(-1)[0],/"joined":1/);
});

test('previewing again retains a confirmed join when only local filing failed',async()=>{
 const f=fixture();f.failFiling=true;f.paste();f.button('folderGroups.joinAndMove').onClick();await flush();
 f.button('folderGroups.preview').onClick();await flush();f.failFiling=false;
 f.button('folderGroups.joinAndMove').onClick();await flush();
 assert.equal(globalThis.importRequests.length,1);assert.equal(f.filed.length,2);assert.match(globalThis.importToasts.at(-1)[0],/"joined":1/);
});

test('an already joined group waits for filing to finish and never requests a second join',async()=>{
 const f=fixture();let finish;f.fileGate=new Promise(resolve=>{finish=resolve;});f.props.existingGroupChatIds={'a|12345@g.us':'existing-chat'};
 f.paste();f.button('folderGroups.joinAndMove').onClick();await flush();
 assert.deepEqual(f.already,['existing-chat']);assert.equal(globalThis.importRequests.length,0);assert.equal(globalThis.importToasts.length,0);
 assert.equal(nodes(f.render()).find(node=>node.type==='textarea').props.disabled,true);
 finish();await flush();assert.match(globalThis.importToasts[0][0],/"already":1/);
});

test('preview failures and administrator approval are shown without claiming a completed import',async()=>{
 const failed=fixture();globalThis.importPreview=async()=>({ok:false,error:'invite expired'});failed.paste();failed.button('folderGroups.joinAndMove').onClick();await flush();
 assert.equal(globalThis.importRequests.length,0);assert.equal(failed.filed.length,0);assert.equal(nodes(failed.render()).find(node=>node.type==='textarea').props.disabled,false);
 assert.ok(nodes(failed.render()).some(node=>node.props.children==='invite expired'));
 const pending=fixture();globalThis.importPreview=async()=>({ok:true,invite:{jid:'12345@g.us',subject:'Approval',joinApprovalMode:true}});globalThis.importAccept=async()=>({ok:true,groupJid:''});
 pending.paste();pending.button('folderGroups.joinAndMove').onClick();await flush();
 assert.equal(pending.filed.length,0);assert.match(globalThis.importToasts[0][0],/"pending":1/);assert.equal(pending.button('folderGroups.joinAndMove').disabled,true);
});
