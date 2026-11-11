import test from 'node:test';
import assert from 'node:assert/strict';
import {autoReplyDelayRange} from '../src/lib/autoReplyDelay.ts';
test('reply wait normalizes disabled, inverted and unsafe ranges',()=>{
 assert.deepEqual(autoReplyDelayRange({}),{min:0,max:0});
 assert.deepEqual(autoReplyDelayRange({aiAutoReplyDelayMinMs:20000,aiAutoReplyDelayMaxMs:60000}),{min:20000,max:60000});
 assert.deepEqual(autoReplyDelayRange({aiAutoReplyDelayMinMs:60000,aiAutoReplyDelayMaxMs:10000}),{min:60000,max:60000});
 assert.deepEqual(autoReplyDelayRange({aiAutoReplyDelayMinMs:-1,aiAutoReplyDelayMaxMs:Infinity}),{min:0,max:0});
 assert.deepEqual(autoReplyDelayRange({aiAutoReplyDelayMinMs:999999,aiAutoReplyDelayMaxMs:999999}),{min:300000,max:300000});
});
