import test from 'node:test';
import assert from 'node:assert/strict';
import {activeFolderSheetIds,foldersBoundToSheet,resolveFolderSheetIds} from '../src/lib/folderSheetBinding.ts';
test('folder sheet bindings inherit, allow overrides and explicit disabling, without replacing missing IDs',()=>{
 const parent={id:'parent',chatIds:[],sheetConnectionId:'sheet-a'},child={id:'child',parentId:'parent',chatIds:['chat']};
 const settings={chatFolders:[parent,child]};
 assert.deepEqual(resolveFolderSheetIds(settings,'chat'),['sheet-a']);
 child.sheetConnectionId='sheet-b';assert.deepEqual(resolveFolderSheetIds(settings,'chat'),['sheet-b']);
 child.sheetConnectionId='none';assert.deepEqual(resolveFolderSheetIds(settings,'chat'),['none']);
 child.sheetConnectionId='deleted';assert.deepEqual(resolveFolderSheetIds(settings,'chat'),['deleted']);
 assert.deepEqual(resolveFolderSheetIds(settings,'unassigned'),[]);
 child.sheetConnectionId='default';assert.deepEqual(resolveFolderSheetIds(settings,'chat'),['default']);
});
test('conflicting folder and cloned memberships require a source choice; cycles terminate',()=>{
 const settings={chatFolders:[{id:'a',chatIds:['chat'],sheetConnectionId:'sheet-a'},{id:'b',chatIds:[],sheetConnectionId:'sheet-b'}],chatFolderClones:[{folderId:'b',sourceChatId:'chat'}]};
 assert.deepEqual(resolveFolderSheetIds(settings,'chat'),['sheet-a','sheet-b']);
 settings.chatFolders[1].sheetConnectionId='sheet-a';assert.deepEqual(resolveFolderSheetIds(settings,'chat'),['sheet-a']);
 const cycle={chatFolders:[{id:'a',parentId:'b',chatIds:['chat']},{id:'b',parentId:'a',chatIds:[]}]};
 assert.deepEqual(resolveFolderSheetIds(cycle,'chat'),[]);
});
test('only explicit folder bindings become active sheet sources',()=>{
 const settings={chatFolders:[{id:'parent',chatIds:[],sheetConnectionId:'sheet-a'},{id:'child',parentId:'parent',chatIds:['chat']},{id:'unassigned',chatIds:['other']}]};
 assert.deepEqual([...activeFolderSheetIds(settings,['chat','other'])],['sheet-a']);
 settings.chatFolders[1].sheetConnectionId='none';
 assert.deepEqual([...activeFolderSheetIds(settings,['chat','other'])],[]);
 settings.chatFolders[1].sheetConnectionId='default';
 assert.deepEqual([...activeFolderSheetIds(settings,['chat','other'])],['default']);
});
test('sheet binding labels show direct and inherited folders but exclude explicit none',()=>{
 const settings={chatFolders:[
  {id:'parent',name:'Main folder',chatIds:[],sheetConnectionId:'sheet-a'},
  {id:'child',name:'Child folder',parentId:'parent',chatIds:[]},
  {id:'override',name:'Override',parentId:'parent',chatIds:[],sheetConnectionId:'sheet-b'},
  {id:'disabled',name:'Disabled',parentId:'parent',chatIds:[],sheetConnectionId:'none'},
  {id:'unbound',name:'Unbound',chatIds:[]},
 ]};
 assert.deepEqual(foldersBoundToSheet(settings,'sheet-a'),[
  {folderId:'parent',folderName:'Main folder',sourceName:'Main folder',inherited:false},
  {folderId:'child',folderName:'Child folder',sourceName:'Main folder',inherited:true},
 ]);
 assert.deepEqual(foldersBoundToSheet(settings,'sheet-b'),[
  {folderId:'override',folderName:'Override',sourceName:'Override',inherited:false},
 ]);
});
