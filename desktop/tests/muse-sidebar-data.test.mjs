import test from 'node:test';
import assert from 'node:assert/strict';
import {museSidebarData,MUSE_SIDEBAR_PERMISSION as allow} from '../src/lib/museSidebarData.ts';
test('sidebar data requires standalone owner permission and isolates the linked customer and source',()=>{
 const settings={chatFolders:[{id:'f',chatIds:['c'],sheetConnectionId:'b'}]};
 const source={id:'b',config:{fields:[{id:'v',label:'Notes'}]},data:{v:{values:{'+12025550100':[{value:'French https://secret.example',links:['secret']}],'+12025550101':[{value:'other person'}]}}}};
 const read=prompt=>museSidebarData(prompt,settings,'c','+12025550100',[source]);
 assert.equal(read(''), '');assert.equal(read('不要'+allow),'');
 assert.deepEqual(JSON.parse(read(allow)),[{field:'Notes',values:['French [link omitted]']}]);
 source.error='failed';assert.equal(read(allow),'[]');delete source.error;
 settings.chatFolders.push({id:'g',chatIds:['c'],sheetConnectionId:'a'});assert.equal(read(allow),'[]');
});
