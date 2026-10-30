import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { resolveAutoReplyScope } from '../src/lib/autoReplyScope.ts';
const result=await build({stdin:{contents:`export {normalizeLoadedSettings} from './src/store/settingsDefaults.ts';export {buildSettingsSafe,parseBackupJson} from './src/lib/exportData.ts';`,resolveDir:fileURLToPath(new URL('../',import.meta.url))},bundle:true,write:false,format:'esm',platform:'node',alias:{'@':fileURLToPath(new URL('../src',import.meta.url))}});
const {normalizeLoadedSettings,buildSettingsSafe,parseBackupJson}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const folder=(id,mode,chatIds=['a'])=>({id,name:id,chatIds,autoReplyMode:mode,sort:0});
test('manual defaults, individual overrides, folder inheritance and conflicts have stable precedence',()=>{
 const settings={aiReplyMode:'semi',chatFolders:[folder('auto','auto')],chatFolderClones:[]};
 assert.deepEqual(resolveAutoReplyScope(settings,'a'),{mode:'auto',source:'folder',folderName:'auto'});
 assert.equal(resolveAutoReplyScope(settings,'b').mode,'manual');
 settings.chatFolders.push(folder('manual','manual',[]));settings.chatFolderClones.push({folderId:'manual',sourceChatId:'a'});
 assert.equal(resolveAutoReplyScope(settings,'a').mode,'manual');
 settings.aiAutoReplyModeByChatId={a:'auto'};assert.equal(resolveAutoReplyScope(settings,'a').mode,'auto');
 settings.aiAutoReplyPaused=true;assert.equal(resolveAutoReplyScope(settings,'a').source,'paused');
 settings.aiAutoReplyPaused=false;settings.aiAutoReplyManualChatIds=['a'];assert.equal(resolveAutoReplyScope(settings,'a').mode,'manual');
});
test('moving, adding and removing folder members changes only the matching conversations',()=>{
 const settings={aiReplyMode:'semi',chatFolders:[folder('f','auto')]};
 settings.chatFolders[0].chatIds.push('b');assert.equal(resolveAutoReplyScope(settings,'b').mode,'auto');
 settings.chatFolders[0].chatIds=['b'];assert.equal(resolveAutoReplyScope(settings,'a').mode,'manual');
 settings.chatFolders=[];assert.equal(resolveAutoReplyScope(settings,'b').mode,'manual');
});
test('stored rules survive restart, reject invalid values, and preserve legacy manual exceptions',()=>{
 const settings=normalizeLoadedSettings({aiReplyMode:'semi',aiAutoReplyPaused:true,aiAutoReplyModeByChatId:{a:'auto',b:'manual',bad:'oops'},aiAutoReplyManualChatIds:['legacy'],chatFolders:[folder('f','auto') ]});
 assert.deepEqual(settings.aiAutoReplyModeByChatId,{a:'auto',b:'manual'});assert.equal(settings.chatFolders[0].autoReplyMode,'auto');
 const restored=normalizeLoadedSettings(JSON.parse(JSON.stringify(settings)));assert.equal(restored.aiAutoReplyPaused,true);assert.deepEqual(restored.aiAutoReplyManualChatIds,['legacy']);
 assert.equal(resolveAutoReplyScope({...restored,aiAutoReplyPaused:false},'legacy').mode,'manual');
 assert.equal(normalizeLoadedSettings({aiAutoReplyPaused:'true',chatFolders:[folder('f','wrong')]}).aiAutoReplyPaused,false);
 assert.equal(normalizeLoadedSettings({chatFolders:[folder('f','wrong')]}).chatFolders[0].autoReplyMode,undefined);
});
test('backup restore cannot silently enable individual or folder automation',()=>{
 const settings=normalizeLoadedSettings({aiAutoReplyModeByChatId:{a:'auto'},chatFolders:[folder('f','auto')]});
 const exported=buildSettingsSafe(settings);assert.equal(exported.aiAutoReplyModeByChatId.a,'auto');
 const restored=parseBackupJson({version:2,contacts:[{id:"a",name:"A",phone:"12025550100"}],settingsSafe:exported});
 assert.equal(restored.settingsSafe.chatFolders[0].autoReplyMode,undefined);
 assert.equal(restored.settingsSafe.aiAutoReplyModeByChatId,undefined);
});

test('multilevel folder parent links and leaf membership survive restart and backup restore',()=>{
 const folders=Array.from({length:12},(_,i)=>({id:`f-${i}`,name:`Level ${i}`,sort:i,...(i?{parentId:`f-${i-1}`} : {}),chatIds:i===11?['a']:[],scope:{type:'all'}}));
 const settings=normalizeLoadedSettings({chatFolders:folders});
 const restarted=normalizeLoadedSettings(JSON.parse(JSON.stringify(settings)));
 const restored=parseBackupJson({version:2,contacts:[{id:'a',name:'A',phone:'12025550100'}],settingsSafe:buildSettingsSafe(settings)});
 for(const value of [restarted.chatFolders,restored.settingsSafe.chatFolders]) {
  assert.deepEqual(value.map(f=>[f.id,f.parentId,f.chatIds]),folders.map(f=>[f.id,f.parentId,f.chatIds]));
 }
});
