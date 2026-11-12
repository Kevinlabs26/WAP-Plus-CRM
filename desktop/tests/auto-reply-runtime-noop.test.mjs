import test from 'node:test';
import assert from 'node:assert/strict';
import {useAutoReplyRuntime,setAutoReplyRuntime} from '../src/lib/autoReplyRuntime.ts';
test('unchanged runtime does not publish or trigger settings persistence',()=>{
 useAutoReplyRuntime.setState({byChat:{}});
 let notifications=0;const unsubscribe=useAutoReplyRuntime.subscribe(()=>notifications++);
 setAutoReplyRuntime('chat',null);assert.equal(notifications,0);
 const value={phase:'waiting',inboundId:'in',retryAt:123};
 setAutoReplyRuntime('chat',value);setAutoReplyRuntime('chat',{...value});assert.equal(notifications,1);
 setAutoReplyRuntime('chat',{...value,phase:'generating'});assert.equal(notifications,2);
 setAutoReplyRuntime('chat',null);setAutoReplyRuntime('chat',null);assert.equal(notifications,3);
 unsubscribe();
});
