import test from 'node:test';
import assert from 'node:assert/strict';
import {createGroupWriteService} from '../baileys-bridge/groupWriteService.mjs';

test('confirmed joins return before optional metadata refresh, even if metadata never finishes',{timeout:5000},async()=>{
 const calls=[];let finish;
 const metadata=new Promise(resolve=>{finish=resolve;});
 const service=createGroupWriteService({getSocket:()=>({groupAcceptInvite:async code=>{calls.push(code);return '12345@g.us';}}),getConnection:()=>'connected',groupService:{fetchMetadata:()=>metadata}});
 try{const result=await service.acceptInvite('https://chat.whatsapp.com/Abcdefgh12345678');assert.equal(result.groupJid,'12345@g.us');assert.deepEqual(calls,['Abcdefgh12345678']);}
 finally{finish({jid:'12345@g.us',subject:'Late metadata'});}
});

test('metadata errors cannot turn a confirmed join into a failed import',async()=>{
 const service=createGroupWriteService({getSocket:()=>({groupAcceptInvite:async()=> '12345@g.us'}),getConnection:()=>'connected',groupService:{fetchMetadata:async()=>{throw Error('metadata unavailable');}}});
 assert.equal((await service.acceptInvite('Abcdefgh12345678')).groupJid,'12345@g.us');
 await new Promise(resolve=>setImmediate(resolve));
});

test('join errors, invalid group IDs and invalid links never produce a confirmed group',async()=>{
 let joined=0;
 const socket={groupAcceptInvite:async()=>{joined++;throw Error('join denied');}};
 const service=createGroupWriteService({getSocket:()=>socket,getConnection:()=>'connected',groupService:{}});
 await assert.rejects(()=>service.acceptInvite('not a link'),/无效/);assert.equal(joined,0);
 await assert.rejects(()=>service.acceptInvite('Abcdefgh12345678'),/join denied/);assert.equal(joined,1);
 socket.groupAcceptInvite=async()=> 'invalid';await assert.rejects(()=>service.acceptInvite('Abcdefgh12345678'),/群 JID/);
 socket.groupAcceptInvite=async()=>undefined;assert.equal((await service.acceptInvite('Abcdefgh12345678')).groupJid,'');
});
