import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveFolderSheetIds} from '../src/lib/folderSheetBinding.ts';
test('folder sheet bindings inherit, allow overrides and explicit disabling, without replacing missing IDs',()=>{
 const parent={id:'parent',chatIds:[],sheetConnectionId:'sheet-a'},child={id:'child',parentId:'parent',chatIds:['chat']};
 const settings={chatFolders:[parent,child]};
 assert.deepEqual(resolveFolderSheetIds(settings,'chat'),['sheet-a']);
 child.sheetConnectionId='sheet-b';assert.deepEqual(resolveFolderSheetIds(settings,'chat'),['sheet-b']);
 child.sheetConnectionId='none';assert.deepEqual(resolveFolderSheetIds(settings,'chat'),['none']);
 child.sheetConnectionId='deleted';assert.deepEqual(resolveFolderSheetIds(settings,'chat'),['deleted']);
 assert.deepEqual(resolveFolderSheetIds(settings,'unassigned'),['default']);
});
test('conflicting folder and cloned memberships require a source choice; cycles terminate',()=>{
 const settings={chatFolders:[{id:'a',chatIds:['chat'],sheetConnectionId:'sheet-a'},{id:'b',chatIds:[],sheetConnectionId:'sheet-b'}],chatFolderClones:[{folderId:'b',sourceChatId:'chat'}]};
 assert.deepEqual(resolveFolderSheetIds(settings,'chat'),['sheet-a','sheet-b']);
 settings.chatFolders[1].sheetConnectionId='sheet-a';assert.deepEqual(resolveFolderSheetIds(settings,'chat'),['sheet-a']);
 const cycle={chatFolders:[{id:'a',parentId:'b',chatIds:['chat']},{id:'b',parentId:'a',chatIds:[]}]};
 assert.deepEqual(resolveFolderSheetIds(cycle,'chat'),['default']);
});
