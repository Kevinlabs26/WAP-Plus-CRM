import test from 'node:test';
import assert from 'node:assert/strict';
import {folderBackground} from '../src/lib/folderAppearance.ts';
test('folder background validates colors and bounds intensity',()=>{
 assert.equal(folderBackground(undefined),undefined);assert.equal(folderBackground('red'),undefined);
 assert.equal(folderBackground('#009688',0),'#00968800');assert.equal(folderBackground('#009688',10),'#0096881a');
 assert.equal(folderBackground('#009688',100),'#00968866');assert.equal(folderBackground('#009688',NaN),'#0096881a');
});

test('row density keeps the existing padding by default and bounds presets',async()=>{
 const {folderRowPadding}=await import('../src/lib/folderAppearance.ts');
 assert.equal(folderRowPadding(undefined),6);assert.equal(folderRowPadding('standard'),6);
 assert.equal(folderRowPadding('compact'),2);assert.equal(folderRowPadding('comfortable'),10);
 assert.equal(folderRowPadding('invalid'),6);
});
