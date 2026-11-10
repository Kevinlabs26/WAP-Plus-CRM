import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

const mocks={
 react:'export const useState=value=>globalThis.cloudUi.state(value);export const useRef=value=>globalThis.cloudUi.ref(value);export const useEffect=(fn,deps)=>globalThis.cloudUi.effect(fn,deps);',
 'react-dom':'export const createPortal=node=>node;',
 'react/jsx-runtime':'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";',
 'lucide-react':'export const ChevronRight=()=>null;export const Folder=ChevronRight,Loader2=ChevronRight,CheckCircle2=ChevronRight,CloudUpload=ChevronRight,Copy=ChevronRight,X=ChevronRight,Download=ChevronRight,Sparkles=ChevronRight,Star=ChevronRight;',
 '@/i18n':'export const useI18n=()=>({t:globalThis.cloudUi.translate});',
 '@tauri-apps/api/core':'export const invoke=async()=>{};',
 '@tauri-apps/api/event':'export const listen=async()=>()=>{};',
 '@/lib/bridge':'export const isTauri=()=>true;export const bridgeInvoke=async()=>{};',
 '@/lib/googleDrive':`export const useGoogleDrive=selector=>selector?selector(globalThis.cloudUi.drive):globalThis.cloudUi.drive;useGoogleDrive.setState=patch=>Object.assign(globalThis.cloudUi.drive,patch);
 export const initializeDrive=async()=>{};export const reloadDriveJournal=async()=>{};export const connectDrive=async()=>{};export const disconnectDrive=async()=>{};
 export const driveFolderId=value=>value;export const driveEmails=value=>value.split(',').map(x=>x.trim());
 export const driveCommand=request=>globalThis.cloudUi.command(request);export const saveDriveConfig=async config=>{globalThis.cloudUi.saved=config;globalThis.cloudUi.drive.config=config;};
 export const copyDriveLink=async()=>{globalThis.cloudUi.copies++;};export const retryDriveUpload=async()=>{globalThis.cloudUi.retries++;};export const uploadContactAvatar=async()=>{};
 export const uploadCloudImage=async(load,title)=>{globalThis.cloudUi.uploaded={source:await load(),title};};`,
 '@/lib/imageGenerationRequest':'export const requestImageGeneration=()=>{};',
 '@/lib/imageLibrary':'export const saveChatImage=async()=>{};',
 '@/lib/desktopNotify':'export const showDesktopNotify=async()=>true;',
 './messageMediaUtils':'export const copyImageToClipboard=async()=>{};',
 '@/store/appStore':'export const useAppStore=selector=>selector({pushToast:()=>{}});',
};
const bundle=await build({stdin:{contents:`export {SettingsCloudImagesPanel} from './src/components/settings/SettingsCloudImagesPanel.tsx';export {CloudUploadStatus,CloudUploadDetails,CloudUploadBanner} from './src/components/chat/CloudUploadStatus.tsx';export {MessageMediaMenuActions} from './src/components/chat/MessageMediaMenuActions.tsx';`,resolveDir:fileURLToPath(new URL('../',import.meta.url))},bundle:true,write:false,format:'esm',platform:'node',alias:{'@':fileURLToPath(new URL('../src',import.meta.url))},plugins:[{name:'cloud-ui-boundaries',setup(b){b.onResolve({filter:/.*/},args=>mocks[args.path]?{path:args.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path]}));}}]});
const {SettingsCloudImagesPanel,CloudUploadStatus,CloudUploadDetails,CloudUploadBanner,MessageMediaMenuActions}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree?.props?[tree,...nodes(tree.props.children)]:[];
const text=node=>Array.isArray(node)?node.map(text).join(''):node?.props?text(node.props.children):typeof node==='string'?node:'';
const button=(tree,key)=>nodes(tree).find(node=>node.type==='button'&&text(node)===key);
const flush=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
const config={email:'owner@example.com',folderId:'chosen',folderName:'Chosen folder',mode:'emails',emails:['friend@example.com']};
function fixture(){
 const cells=[],effects=[];let cursor=0;
 const f=globalThis.cloudUi={drive:{ready:true,configured:true,email:config.email,needsAccess:false,connecting:false,uploadBusy:false,config,job:null,jobs:[],selectedJobId:null,journalError:'',menu:null},copies:0,retries:0,translate:key=>key,
  state(initial){const i=cursor++;cells[i]??={value:typeof initial==='function'?initial():initial};return[cells[i].value,next=>{cells[i].value=typeof next==='function'?next(cells[i].value):next;}];},
  ref(value){return cells[cursor++]??={current:value};},
  effect(fn,deps){const i=cursor++,old=cells[i];if(old&&deps.every((value,j)=>Object.is(value,old.deps[j])))return;cells[i]={deps,cleanup:old?.cleanup};effects.push(()=>{cells[i].cleanup?.();cells[i].cleanup=fn();});},
  command:async()=>({files:[]}),
  render(Component=SettingsCloudImagesPanel){cursor=0;const tree=Component();while(effects.length)effects.shift()();return tree;},
  close(){for(const cell of cells)cell?.cleanup?.();delete globalThis.cloudUi;},
 };
 return f;
}

test('cloud settings browse Drive folders, preserve existing selections, and save sharing choices without an upload',async()=>{
 const f=fixture();try{
  f.command=async request=>request.action==='folders'?{files:[{id:'child',name:'Child folder'}]}:{id:request.folderId,name:'Linked folder'};
  f.render();f.render();await flush();let tree=f.render();
  assert.match(text(tree),/Chosen folder/);
  const child=nodes(tree).find(node=>node.type==='button'&&text(node).includes('Child folder'));child.props.onClick();tree=f.render();await flush();tree=f.render();
  button(tree,'cloud.useFolder').props.onClick();tree=f.render();
  const emails=nodes(tree).find(node=>node.props['aria-label']==='cloud.emails');emails.props.onChange({target:{value:'one@example.com,two@example.com'}});
  tree=f.render();await button(tree,'cloud.save').props.onClick();tree=f.render();
  assert.equal(f.saved.folderId,'child');assert.deepEqual(f.saved.emails,['one@example.com','two@example.com']);assert.equal(f.saved.mode,'emails');assert.match(text(tree),/cloud.saved/);
  nodes(tree).find(node=>node.type==='input'&&node.props.value==='public').props.onChange();tree=f.render();
  await button(tree,'cloud.save').props.onClick();tree=f.render();assert.deepEqual(f.saved.emails,[]);assert.equal(f.saved.mode,'public');assert.match(text(tree),/cloud.publicHint/);assert.equal(f.uploaded,undefined);
 }finally{f.close();}
});

test('late folder responses from a previous account cannot replace the new account browser',async()=>{
 const f=fixture();try{
  let oldResolve,newResolve;
  f.command=request=>new Promise(resolve=>{if(request.email===config.email)oldResolve=resolve;else newResolve=resolve;});
  f.render();f.render();
  f.drive.email='new@example.com';f.drive.config=null;f.render();f.render();
  newResolve({files:[{id:'new',name:'New private folder'}]});await flush();let tree=f.render();assert.match(text(tree),/New private folder/);
  oldResolve({files:[{id:'old',name:'Wrong old folder'}]});await flush();tree=f.render();assert.match(text(tree),/New private folder/);assert.doesNotMatch(text(tree),/Wrong old folder/);assert.doesNotMatch(text(tree),/Chosen folder/);
 }finally{f.close();}
});

test('cloud upload has a compact progress status outside settings while details remain available there',async()=>{
 for(const Component of [CloudUploadStatus,SettingsCloudImagesPanel]){
  const f=fixture();try{
   f.drive.job={title:'Portrait',config,stage:'uploading'};f.drive.uploadBusy=true;
   const tree=f.render(Component);
   if(Component===CloudUploadStatus)assert.equal(nodes(tree).some(node=>node.type==='aside'),false);
   else assert.ok(nodes(tree).some(node=>node.type===CloudUploadDetails));
  }finally{f.close();}
 }
});

test('top status shows byte percentage, copies the link again, expires at ten seconds and is replaced by the next upload',async()=>{
 const f=fixture();try{
  f.drive.job={id:'first',title:'Portrait',config,stage:'uploading',uploadProgress:47};f.drive.uploadBusy=true;
  let tree=f.render(CloudUploadBanner);assert.equal(nodes(tree).find(node=>node.props.role==='progressbar').props['aria-valuenow'],47);assert.match(text(tree),/47%/);
  f.drive.uploadBusy=false;f.drive.job={...f.drive.job,stage:'done',completedAt:Date.now(),shared:true,url:'https://drive.google.com/file/d/one/view'};
  tree=f.render(CloudUploadBanner);assert.match(text(tree),/cloud.copyAgainHint/);await button(tree,'cloud.copy').props.onClick();assert.equal(f.retries,1);
  f.drive.job={...f.drive.job,completedAt:Date.now()-10_001};assert.equal(f.render(CloudUploadBanner),null);
  f.drive.job={...f.drive.job,id:'second',stage:'uploading',uploadProgress:1,completedAt:undefined};f.drive.uploadBusy=true;
  tree=f.render(CloudUploadBanner);assert.match(text(tree),/second|Portrait/);assert.equal(nodes(tree).find(node=>node.props.role==='progressbar').props['aria-valuenow'],1);
 }finally{f.close();}
});

test('settings details distinguish active, failed sharing, clipboard failure and copied completion',async()=>{
 const f=fixture();try{
  f.drive.job={title:'Portrait',config,stage:'uploading'};f.drive.uploadBusy=true;
  let tree=f.render(CloudUploadDetails);assert.match(text(tree),/cloud.stage.uploading/);assert.equal(nodes(tree).find(node=>node.props['aria-label']==='cloud.close').props.disabled,true);assert.equal(button(tree,'cloud.retry'),undefined);assert.equal(tree.props.className.includes('fixed'),false);
  f.drive.uploadBusy=false;f.drive.job={...f.drive.job,stage:'error',error:'sharing rejected',shared:false,url:'https://drive.google.com/file/d/file/view'};
  tree=f.render(CloudUploadDetails);assert.match(text(tree),/sharing rejected/);assert.equal(nodes(tree).some(node=>node.props['aria-label']==='cloud.link'),false);await button(tree,'cloud.retry').props.onClick();assert.equal(f.retries,1);
  f.drive.job={...f.drive.job,stage:'copyError',shared:true};tree=f.render(CloudUploadDetails);assert.match(text(tree),/cloud.stage.copyError/);assert.ok(nodes(tree).some(node=>node.props['aria-label']==='cloud.link'));await button(tree,'cloud.copy').props.onClick();assert.equal(f.retries,2);
  f.drive.job={...f.drive.job,stage:'done',error:undefined};tree=f.render(CloudUploadDetails);assert.match(text(tree),/cloud.stage.done/);assert.equal(button(tree,'cloud.retry'),undefined);
 }finally{f.close();}
});

test('chat image upload captures the selected picture and unavailable images have a disabled action',async()=>{
 const f=fixture();try{
  const message={id:'image-id',mediaType:'image',mediaFileName:'photo.jpg',mediaUrl:'data:image/jpeg;base64,original'};
  let closed=false;
  const props={message,mediaKind:'image',canSave:true,stickerFavorited:false,onToggleSticker:async()=>{},onClose:()=>{closed=true;message.mediaUrl='changed-after-menu-close';}};
  let tree=MessageMediaMenuActions(props);button(tree,'cloud.upload').props.onClick();await flush();assert.equal(closed,true);assert.deepEqual(f.uploaded,{source:'data:image/jpeg;base64,original',title:'photo.jpg'});
  tree=MessageMediaMenuActions({...props,canSave:false});assert.equal(button(tree,'cloud.upload').props.disabled,true);
 }finally{f.close();}
});
