import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { resolveAutoReplyScope } from '../src/lib/autoReplyScope.ts';
const result=await build({stdin:{contents:`export {normalizeLoadedSettings} from './src/store/settingsDefaults.ts';export {buildSettingsSafe,parseBackupJson} from './src/lib/exportData.ts';`,resolveDir:fileURLToPath(new URL('../',import.meta.url))},bundle:true,write:false,format:'esm',platform:'node',alias:{'@':fileURLToPath(new URL('../src',import.meta.url))}});
const {normalizeLoadedSettings,buildSettingsSafe,parseBackupJson}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const folder=(id,mode,chatIds=['a'])=>({id,name:id,chatIds,autoReplyMode:mode,sort:0});

test('pinned and recent reply IDs survive reload and backup, pruning duplicates, invalid and deleted IDs', () => {
 const quickReplies=Array.from({length:30},(_,i)=>({id:'r'+i,title:'Title '+i,body:'Body',category:'other'}));
 const settings=normalizeLoadedSettings({quickReplies,quickReplyPinnedIds:['r2','r2','gone',null,{}],quickReplyRecentIds:['r1','r1','gone',...quickReplies.map(r=>r.id)]});
 assert.deepEqual(settings.quickReplyPinnedIds,['r2']);assert.equal(settings.quickReplyRecentIds.length,20);
 assert.deepEqual(settings.quickReplyRecentIds.slice(0,3),['r1','r0','r2']);
 const backup=parseBackupJson({version:2,contacts:[{id:'a',name:'A',phone:'12025550100'}],settingsSafe:buildSettingsSafe(settings)});
 const restored=normalizeLoadedSettings(backup.settingsSafe);
 assert.deepEqual(restored.quickReplyPinnedIds,['r2']);assert.deepEqual(restored.quickReplyRecentIds,settings.quickReplyRecentIds);
 assert.deepEqual(normalizeLoadedSettings({...settings,quickReplies:[]}).quickReplyPinnedIds,[]);
 assert.deepEqual(normalizeLoadedSettings({quickReplyPinnedIds:{},quickReplyRecentIds:'bad'}).quickReplyRecentIds,[]);
});

test('large quick reply libraries and custom categories survive reload and backup, and deletion stays empty', () => {
 const categories=Array.from({length:100},(_,i)=>({id:'custom-'+i,label:'Category '+i}));
 const replies=Array.from({length:1000},(_,i)=>({id:'reply-'+i,title:'Title '+i,body:'Body '+i,category:categories[i%100].id}));
 const settings=normalizeLoadedSettings({quickReplies:replies,quickReplyCustomCategories:categories});
 const restarted=normalizeLoadedSettings(JSON.parse(JSON.stringify(settings)));
 assert.deepEqual(restarted.quickReplies,replies.map(r=>({...r,media:undefined})));
 assert.equal(restarted.quickReplyCustomCategories.length,100);
 const restored=parseBackupJson({version:2,contacts:[{id:'a',name:'A',phone:'12025550100'}],settingsSafe:buildSettingsSafe(settings)});
 assert.equal(restored.settingsSafe.quickReplies.length,1000);
 assert.deepEqual(normalizeLoadedSettings({quickReplies:[]}).quickReplies,[]);
 assert.equal(normalizeLoadedSettings({quickReplies:[...replies,{...replies[0],id:'extra'}]}).quickReplies.length,1000);
});

test('folder prompts survive normalization and backup restore without enabling automatic sending', () => {
 const settings=normalizeLoadedSettings({aiReplyMode:'semi', chatFolders:[
  {...folder('profile',undefined),aiSystemPrompt:'  FOLDER ROLE  '},
  {...folder('blank',undefined,[]),aiSystemPrompt:'  '},
  {...folder('bad',undefined,[]),aiSystemPrompt:{text:'invalid'}},
  {...folder('long',undefined,[]),aiSystemPrompt:'x'.repeat(7000)},
 ]});
 assert.equal(settings.chatFolders.find(f=>f.id==='profile').aiSystemPrompt,'FOLDER ROLE');
 assert.equal(settings.chatFolders.find(f=>f.id==='blank').aiSystemPrompt,undefined);
 assert.equal(settings.chatFolders.find(f=>f.id==='bad').aiSystemPrompt,undefined);
 assert.equal(settings.chatFolders.find(f=>f.id==='long').aiSystemPrompt.length,6000);
 const restarted=normalizeLoadedSettings(JSON.parse(JSON.stringify(settings)));
 assert.equal(restarted.chatFolders.find(f=>f.id==='profile').aiSystemPrompt,'FOLDER ROLE');
 assert.equal(resolveAutoReplyScope(restarted,'a').mode,'manual');
 const safe=buildSettingsSafe(settings);
 const restored=parseBackupJson({version:2,contacts:[{id:'a',name:'A',phone:'12025550100'}],settingsSafe:safe});
 assert.equal(restored.settingsSafe.chatFolders.find(f=>f.id==='profile').aiSystemPrompt,'FOLDER ROLE');
});

test('nested folders inherit the nearest explicit rule while individual settings and conflicting paths keep precedence',()=>{
 const parent=folder('parent','manual',[]),child={...folder('child',undefined,['a']),parentId:'parent'};
 const settings={aiReplyMode:'auto',chatFolders:[parent,child]};
 assert.deepEqual(resolveAutoReplyScope(settings,'a'),{mode:'manual',source:'folder',folderName:'parent'});
 child.autoReplyMode='auto';assert.equal(resolveAutoReplyScope(settings,'a').mode,'auto');
 settings.chatFolders.push(folder('other','manual',['a']));assert.equal(resolveAutoReplyScope(settings,'a').mode,'manual');
 settings.aiAutoReplyModeByChatId={a:'auto'};assert.equal(resolveAutoReplyScope(settings,'a').source,'chat');
 delete settings.aiAutoReplyModeByChatId;settings.chatFolders=[{...parent,parentId:'child',autoReplyMode:undefined},{...child,autoReplyMode:undefined}];
 assert.equal(resolveAutoReplyScope(settings,'a').source,'default','cycles terminate safely');
 settings.chatFolders=[parent,{...child,autoReplyMode:undefined,chatIds:[]}];settings.chatFolderClones=[{sourceChatId:'a',folderId:'child'}];
 assert.equal(resolveAutoReplyScope(settings,'a').folderName,'parent','cloned membership inherits too');
});
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
