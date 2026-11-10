import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

const mocks={
  zustand:'export const create=fn=>{let state=fn();const store=selector=>selector?selector(state):state;store.getState=()=>state;store.setState=patch=>{state={...state,...patch};};return store;};',
  '@tauri-apps/api/core':'export const invoke=(...args)=>globalThis.driveFixture.invoke(...args);',
  '@tauri-apps/api/event':'export const listen=async(name,fn)=>{const f=globalThis.driveFixture;if(f.listenerFailure)throw Error("events unavailable");f.listeners[name]=fn;return()=>{delete f.listeners[name];};};',
  './idb':'export const idbGet=async()=>globalThis.driveFixture.saved;export const idbSet=async(_key,value)=>{if(globalThis.driveFixture.persistenceFailure)throw Error("local storage unavailable");globalThis.driveFixture.saved=value;};',
  './bridge':'export const isTauri=()=>true;',
  './baileys':'export const baileysFetchAvatar=options=>globalThis.driveFixture.avatar(options);',
  '@/store/appStore':'export const useAppStore={getState:()=>globalThis.driveFixture.app};',
  './desktopNotify':'export const registerDesktopNotifyAction=()=>{};export const showDesktopNotify=async options=>{const f=globalThis.driveFixture;f.notifications.push(options);if(f.onNotify)await f.onNotify(options);if(f.notificationFailure)throw Error("notification unavailable");return f.notificationAllowed!==false;};',
  '@/i18n':'export const translateCurrent=key=>key;',
};
const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/lib/googleDrive.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'drive-boundaries',setup(b){b.onResolve({filter:/.*/},args=>mocks[args.path]?{path:args.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path]}));}}]});
let fixtureId=0;
const config={email:'owner@example.com',folderId:'folder_1',folderName:'Images',mode:'emails',emails:['friend@example.com']};
const source='data:image/png;base64,iVBORw0KGgo=';
async function fixture(){
  const f=globalThis.driveFixture={saved:structuredClone(config),savedJobs:[],fileCounter:0,calls:[],toasts:[],opened:[],copies:[],notifications:[],listeners:{},status:{configured:true,email:config.email,needsAccess:false},uploadFailure:false,sharingFailure:false,copyFailure:false,
    app:{settings:{sendChannel:'baileys'},pushToast:(...args)=>f.toasts.push(args),setSettingsOpen:(...args)=>f.opened.push(args)},
    avatar:async()=>({avatarFullUrl:source}),
    async invoke(command,args){
      f.calls.push([command,structuredClone(args)]);
      if(command==='google_drive_jobs'){if(f.journalFailure)throw Error('journal disk error');if(args?.jobs)f.savedJobs=structuredClone(args.jobs);return structuredClone(f.savedJobs);}
      if(command==='google_sheets_status'||command==='google_sheets_connect')return f.status;
      if(command==='google_sheets_disconnect'||command==='google_sheets_prepare_connect')return;
      if(command==='clipboard_write_text'){if(f.copyFailure)throw Error('clipboard busy');f.copies.push(args.text);return;}
      const request=args.request;
      if(request.action==='folder')return{id:request.folderId==='root'?'canonical_root':request.folderId,name:'Images'};
      if(request.action==='prepare')return{ids:[`generated_file_${++f.fileCounter}`]};
      if(request.action==='upload'){
        f.listeners['google-drive-upload-progress']?.({payload:{fileId:request.fileId,loaded:50,total:100}});
        f.listeners['google-drive-upload-progress']?.({payload:{fileId:request.fileId,loaded:100,total:100}});
        f.listeners['google-drive-upload-stage']?.({payload:{fileId:request.fileId,stage:'sharing'}});
        if(f.onUpload)await f.onUpload(request);
        if(f.uploadFailure)throw Error('network interrupted');
        return{fileId:request.fileId,url:`https://drive.google.com/file/d/${request.fileId}/view`,shared:!f.sharingFailure,sharingError:f.sharingFailure?'sharing rejected':undefined};
      }
      throw Error(`unexpected ${command}`);
    },
  };
  const code=bundle.outputFiles[0].text+`\n//# sourceURL=drive-fixture-${++fixtureId}.js`;
  const api=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
  return{...api,f};
}

test('folder links and recipient configuration reject invalid targets and deduplicate emails',async()=>{
  const a=await fixture();
  assert.equal(a.driveFolderId('https://drive.google.com/drive/u/1/folders/abc_123?usp=sharing'),'abc_123');
  assert.equal(a.driveFolderId('https://evil.test/drive/folders/abc'),null);
  assert.equal(a.driveFolderId('../folder'),null);
  assert.deepEqual(a.driveEmails('A@EXAMPLE.com; a@example.com，b@example.com'),['a@example.com','b@example.com']);
  for(const invalid of [{...config,mode:'other'},{...config,emails:[]},{...config,emails:['bad@']},{...config,folderId:"x' or true"}])assert.throws(()=>a.validateDriveConfig(invalid));
  assert.doesNotThrow(()=>a.validateDriveConfig({...config,mode:'public',emails:[]}));
});

test('upload reports byte progress, shares with saved recipients, then copies the URL without a Windows notification',async()=>{
  const a=await fixture();let loads=0;
  await a.uploadCloudImage(()=>{loads++;return source;},'Portrait');
  assert.equal(loads,1);assert.equal(a.useGoogleDrive.getState().job.stage,'done');assert.equal(a.useGoogleDrive.getState().uploadBusy,false);
  const upload=a.f.calls.find(([,args])=>args?.request?.action==='upload')[1].request;
  assert.equal(upload.email,config.email);assert.equal(upload.folderId,config.folderId);assert.deepEqual(upload.emails,config.emails);assert.equal(upload.mode,'emails');
  assert.deepEqual(a.f.copies,['https://drive.google.com/file/d/generated_file_1/view']);assert.deepEqual(a.f.listeners,{});
  assert.equal(a.useGoogleDrive.getState().job.uploadProgress,100);assert.ok(a.useGoogleDrive.getState().job.completedAt>0);
  assert.equal(a.useGoogleDrive.getState().job.data,undefined,'completed jobs release image bytes');
  assert.equal(a.f.notifications.length,0);
});

test('optional progress listener failures do not block uploads, and simultaneous clicks create only one job',async()=>{
  const a=await fixture();a.f.listenerFailure=true;
  await Promise.all([a.uploadCloudImage(()=>source,'First'),a.uploadCloudImage(()=>source,'Second')]);
  assert.equal(a.useGoogleDrive.getState().job.stage,'done');
  assert.equal(a.f.calls.filter(([,args])=>args?.request?.action==='upload').length,1);
});

test('network uncertainty and failed sharing remain visible in-app, reuse the generated file ID and do not copy an unshared link',async()=>{
  for(const failure of ['uploadFailure','sharingFailure']){
    const a=await fixture();let loads=0;a.f[failure]=true;
    await a.uploadCloudImage(()=>{loads++;return source;},'Photo');
    assert.equal(a.f.copies.length,0);assert.equal(a.useGoogleDrive.getState().job.stage,'error');
    assert.equal(a.f.notifications.length,0);assert.match(a.useGoogleDrive.getState().job.error,failure==='uploadFailure'?/network interrupted/:/sharing rejected/);
    await assert.rejects(()=>a.copyDriveLink());
    a.f[failure]=false;await a.retryDriveUpload();
    const requests=a.f.calls.filter(([,args])=>args?.request?.action==='upload').map(([,args])=>args.request);
    assert.equal(requests.length,2);assert.equal(requests[0].fileId,requests[1].fileId);
    assert.equal(a.f.calls.filter(([,args])=>args?.request?.action==='prepare').length,1);assert.equal(loads,1);assert.equal(a.f.copies.length,1);
  }
});

test('a clipboard failure is visible and retries only clipboard writing',async()=>{
  const a=await fixture();a.f.copyFailure=true;
  await a.uploadCloudImage(()=>source,'Photo');
  assert.equal(a.useGoogleDrive.getState().job.stage,'copyError');assert.equal(a.useGoogleDrive.getState().job.shared,true);
  assert.equal(a.f.notifications.length,0);assert.ok(a.useGoogleDrive.getState().job.error);
  a.f.copyFailure=false;await Promise.all([a.retryDriveUpload(),a.uploadCloudImage(()=>source,'Second photo')]);
  assert.equal(a.useGoogleDrive.getState().job.stage,'done');assert.equal(a.f.calls.filter(([,args])=>args?.request?.action==='upload').length,1);
  assert.ok(a.useGoogleDrive.getState().job.completedAt>0);
});

test('unconfigured or changed accounts open the dedicated settings without uploading',async()=>{
  for(const change of [f=>{f.saved=null;},f=>{f.status.email='other@example.com';},f=>{f.status.needsAccess=true;}]){
    const a=await fixture();change(a.f);await a.uploadCloudImage(()=>source,'Photo');
    assert.deepEqual(a.f.opened,[[true,'cloud-images']]);assert.equal(a.f.calls.some(([,args])=>args?.request?.action==='upload'),false);
  }
});

test('one active upload freezes its target configuration and blocks duplicate clicks and account changes',async()=>{
  const a=await fixture();let release;const gate=new Promise(resolve=>release=resolve);
  a.f.onUpload=()=>gate;
  const pending=a.uploadCloudImage(()=>source,'First');
  for(let n=0;n<20&&!a.f.onUploadStarted;n++){await new Promise(resolve=>setImmediate(resolve));if(a.f.calls.some(([,args])=>args?.request?.action==='upload'))break;}
  assert.equal(a.useGoogleDrive.getState().uploadBusy,true);
  a.useGoogleDrive.getState().config.emails.push('late@example.com');
  await a.uploadCloudImage(()=>source,'Second');await a.connectDrive();await a.disconnectDrive();
  await assert.rejects(()=>a.saveDriveConfig(config));
  assert.equal(a.f.calls.filter(([,args])=>args?.request?.action==='upload').length,1);
  assert.equal(a.f.calls.some(([command])=>command==='google_sheets_connect'||command==='google_sheets_disconnect'),false);
  assert.deepEqual(a.useGoogleDrive.getState().job.config.emails,['friend@example.com']);
  release();await pending;
});

test('configuration persists the canonical folder ID, and avatar loading uses the actual chat account',async()=>{
  const a=await fixture();await a.initializeDrive();
  await a.saveDriveConfig({...config,folderId:'root'});assert.equal(a.f.saved.folderId,'canonical_root');
  let account;a.f.avatar=async options=>{account=options.accountId;return{avatarFullUrl:source};};
  await a.uploadContactAvatar({id:'person',phone:'+12025550100',name:'Person',accountId:'wrong'},'actual-account');
  assert.equal(account,'actual-account');assert.equal(a.useGoogleDrive.getState().job.stage,'done');
});

test('missing or oversized image data fails before preparing or sharing a cloud file',async()=>{
  for(const load of [()=>{throw Error('image missing');},()=>`data:image/png;base64,${'A'.repeat(12*1024*1024)}`]){
    const a=await fixture();await a.uploadCloudImage(load,'Photo');
    assert.equal(a.useGoogleDrive.getState().job.stage,'error');assert.equal(a.f.calls.some(([,args])=>args?.request?.action==='prepare'),false);
  }
});

test('Drive account changes never touch the Sheets authorization, including local persistence failures',async()=>{
  const a=await fixture();await a.initializeDrive();
  a.f.status={...a.f.status,email:'new@example.com'};a.f.persistenceFailure=true;
  await a.connectDrive();assert.equal(a.useGoogleDrive.getState().email,'new@example.com');assert.equal(a.useGoogleDrive.getState().config,null);
  await assert.rejects(()=>a.disconnectDrive());assert.equal(a.useGoogleDrive.getState().email,null);
  for(const [command,args] of a.f.calls.filter(([command])=>['google_sheets_status','google_sheets_connect','google_sheets_disconnect'].includes(command)))assert.equal(args.drive,true,command);
});

test('restarting restores interrupted uploads with the same remote identity and no second prepare request',async()=>{
 const first=await fixture();first.f.uploadFailure=true;
 await first.uploadCloudImage(()=>source,'Interrupted portrait');
 const saved=structuredClone(first.f.savedJobs),original=saved[0];assert.ok(original.fileId);
 const restarted=await fixture();restarted.f.savedJobs=saved;await restarted.initializeDrive();
 assert.equal(restarted.useGoogleDrive.getState().job.id,original.id);
 await restarted.retryDriveUpload(original.id);
 const upload=restarted.f.calls.find(([,args])=>args?.request?.action==='upload')[1].request;
 assert.equal(upload.fileId,original.fileId);assert.equal(restarted.f.calls.some(([,args])=>args?.request?.action==='prepare'),false);
 assert.equal(restarted.useGoogleDrive.getState().job.stage,'done');
 assert.equal(restarted.f.savedJobs[0].data,undefined);assert.equal('load' in restarted.f.savedJobs[0],false);
});

test('new uploads replace the visible result while older jobs remain available from settings',async()=>{
 const a=await fixture();await a.uploadCloudImage(()=>source,'A');
 const first=a.useGoogleDrive.getState().job;
 await a.uploadCloudImage(()=>source,'B');const second=a.useGoogleDrive.getState().job;
 assert.notEqual(first.id,second.id);assert.deepEqual(a.useGoogleDrive.getState().jobs.map(job=>job.id),[second.id,first.id]);
 assert.equal(a.f.notifications.length,0);
 await a.retryDriveUpload(first.id);assert.equal(a.f.copies.at(-1),first.url);
});

test('journal failures stop new remote files and recovery history and image bytes stay bounded',async()=>{
 const a=await fixture();await a.initializeDrive();a.f.journalFailure=true;
 await a.uploadCloudImage(()=>source,'Cannot save');assert.equal(a.f.calls.some(([,args])=>args?.request?.action==='upload'),false);
 assert.equal(a.useGoogleDrive.getState().job.stage,'error');assert.match(a.useGoogleDrive.getState().journalError,/disk error/);
 a.f.journalFailure=false;await a.retryDriveUpload();assert.equal(a.useGoogleDrive.getState().job.stage,'done');
 a.f.uploadFailure=true;
 for(let i=0;i<34;i++)await a.uploadCloudImage(()=>source,'Image '+i);
 assert.equal(a.f.savedJobs.length,30);assert.equal(a.f.savedJobs.filter(job=>job.data).length,3);
});

test('a startup status failure cannot skip restoring old tasks or overwrite them after reconnecting',async()=>{
 const original=await fixture();original.f.uploadFailure=true;await original.uploadCloudImage(()=>source,'Existing task');
 const saved=structuredClone(original.f.savedJobs),oldId=saved[0].id;
 const a=await fixture();a.f.savedJobs=saved;let fail=true;const invoke=a.f.invoke;
 a.f.invoke=async(command,args)=>{if(command==='google_sheets_status'&&fail)throw Error('temporary status failure');return invoke(command,args);};
 await a.initializeDrive();assert.equal(a.useGoogleDrive.getState().jobs[0].id,oldId);
 fail=false;await a.connectDrive();await a.saveDriveConfig(config);await a.uploadCloudImage(()=>source,'New task');
 assert.equal(a.useGoogleDrive.getState().job.stage,'done');assert.ok(a.f.savedJobs.some(job=>job.id===oldId));
 assert.equal(a.f.calls.filter(([command,args])=>command==='google_drive_jobs'&&!args?.jobs).length,1);
});

test('an unread journal stays protected across reconnection until the journal reload succeeds',async()=>{
 const original=await fixture();original.f.uploadFailure=true;await original.uploadCloudImage(()=>source,'Keep this task');
 const saved=structuredClone(original.f.savedJobs);
 const a=await fixture();a.f.savedJobs=saved;a.f.journalFailure=true;
 await a.initializeDrive();await a.connectDrive();await a.saveDriveConfig(config);await a.uploadCloudImage(()=>source,'Blocked task');
 assert.deepEqual(a.f.savedJobs,saved);assert.equal(a.f.calls.some(([command,args])=>command==='google_drive_jobs'&&args?.jobs),false);
 assert.equal(a.f.calls.some(([,args])=>args?.request?.action==='upload'),false);
 a.f.journalFailure=false;await a.reloadDriveJournal();await a.uploadCloudImage(()=>source,'Recovered task');
 assert.equal(a.useGoogleDrive.getState().job.stage,'done');assert.ok(a.f.savedJobs.some(job=>job.id===saved[0].id));
});

test('retrying journal persistence keeps newer unsaved tasks and their image loader in memory',async()=>{
 const a=await fixture();await a.initializeDrive();a.f.journalFailure=true;
 await a.uploadCloudImage(()=>source,'Unsaved task');const job=a.useGoogleDrive.getState().job;
 assert.equal(a.f.savedJobs.length,0);assert.equal(typeof job.load,'function');
 a.f.journalFailure=false;await a.reloadDriveJournal();
 assert.equal(a.useGoogleDrive.getState().job.id,job.id);assert.equal(typeof a.useGoogleDrive.getState().job.load,'function');
 assert.equal(a.f.savedJobs[0].id,job.id);await a.retryDriveUpload(job.id);assert.equal(a.useGoogleDrive.getState().job.stage,'done');
});

test('repeated reload clicks share a single journal read',async()=>{
 const a=await fixture();a.f.journalFailure=true;await a.initializeDrive();a.f.journalFailure=false;
 const invoke=a.f.invoke;let reads=0,release;
 const gate=new Promise(resolve=>{release=resolve;});
 a.f.invoke=async(command,args)=>{if(command==='google_drive_jobs'&&!args?.jobs){reads++;await gate;}return invoke(command,args);};
 const first=a.reloadDriveJournal(),second=a.reloadDriveJournal();
 assert.equal(first,second);await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,1);
 release();await Promise.all([first,second]);assert.equal(a.useGoogleDrive.getState().journalError,'');
});
