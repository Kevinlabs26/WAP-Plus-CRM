import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const mocks={
 '@/lib/googleDrive':'export const uploadCloudImage=async()=>{};',
 react:'export const useState=value=>[value,()=>{}];',
 'react/jsx-runtime':'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";',
 'lucide-react':'export const Copy=()=>null;export const CloudUpload=Copy,Download=Copy,Loader2=Copy,Sparkles=Copy,Star=Copy;',
 '@/store/appStore':'export const useAppStore=selector=>selector({pushToast:(...args)=>globalThis.downloadToasts.push(args)});',
 '@/lib/imageGenerationRequest':'export const requestImageGeneration=()=>{};',
 '@/lib/imageLibrary':'export const saveChatImage=async()=>{};',
 './messageMediaUtils':'export const copyImageToClipboard=async()=>{};',
 '@/i18n':'export const useI18n=()=>({t:(key,args)=>key+JSON.stringify(args||{})});',
 '@tauri-apps/api/event':'export const listen=async()=>()=>{};',
 '@/lib/bridge':`export const isTauri=()=>true;export const bridgeInvoke=async command=>{
    globalThis.downloadCommands.push(command);
    if(command==='save_chat_media'){if(globalThis.downloadFailure)throw Error('disk full');return {fileName:'clip.mp4',path:'C:/Downloads/WAP Plus CRM/clip.mp4'};}
  };`,
 '@/lib/desktopNotify':'export const showDesktopNotify=async options=>{globalThis.downloadNotifications.push(options);return globalThis.allowDownloadNotification;};',
};
const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/components/chat/MessageMediaMenuActions.tsx',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',alias:{'@':fileURLToPath(new URL('../src',import.meta.url))},plugins:[{name:'download-boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {MessageMediaMenuActions}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text+'\n//# sourceURL=media-download-notification-fixture.js').toString('base64'));
function buttons(node){if(!node)return [];if(Array.isArray(node))return node.flatMap(buttons);return [...(node.type==='button'?[node]:[]),...buttons(node.props?.children)];}
async function download(allow=true,failure=false){
 globalThis.downloadToasts=[];globalThis.downloadCommands=[];globalThis.downloadNotifications=[];globalThis.allowDownloadNotification=allow;globalThis.downloadFailure=failure;
 let closed=false;
 const tree=MessageMediaMenuActions({message:{id:'clip',mediaType:'video',mediaFileName:'clip.mp4',mediaUrl:'data:video/mp4;base64,AAAA'},mediaKind:'video',canSave:true,stickerFavorited:false,onToggleSticker:async()=>{},onClose:()=>{closed=true;}});
 buttons(tree)[0].props.onClick();
 for(let i=0;i<20&&!closed;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(closed,true);
}
test('download completion uses the OS notifier with the saved filename and folder action',async()=>{
 await download();assert.deepEqual(globalThis.downloadCommands,['save_chat_media']);
 const [notification]=globalThis.downloadNotifications;assert.equal(notification.action,'downloads');
 assert.match(notification.title,/clip.mp4/);assert.match(notification.body,/C:\/Downloads/);
 assert.equal(globalThis.downloadToasts.length,0);
 await notification.onClick();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(globalThis.downloadCommands,['save_chat_media','open_chat_media_folder']);
});
test('unavailable OS notifications retain a small path fallback without recreating the internal right-side card',async()=>{
 await download(false);assert.equal(globalThis.downloadToasts.length,1);
 const [text,tone,options]=globalThis.downloadToasts[0];assert.match(text,/savedNoSystemNotice/);assert.equal(tone,'info');assert.equal(options,undefined);
});
test('a failed save never produces a misleading download-complete notification',async()=>{
 await download(true,true);assert.equal(globalThis.downloadNotifications.length,0);assert.equal(globalThis.downloadToasts[0][1],'error');
});
