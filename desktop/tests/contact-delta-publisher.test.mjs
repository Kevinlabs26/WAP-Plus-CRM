import test from 'node:test';
import assert from 'node:assert/strict';
import { createContactDeltaPublisher } from '../baileys-bridge/contactStore.mjs';

test('unchanged periodic snapshots do not repeat full contact lists or avatar payloads',()=>{
  const sent=[];
  const publish=createContactDeltaPublisher(rows=>sent.push(structuredClone(rows)));
  const rows=Array.from({length:1000},(_,i)=>({jid:`${i}@s.whatsapp.net`,displayName:`Person ${i}`,avatarUrl:'data:image/jpeg;base64,'+'A'.repeat(4096)}));
  assert.equal(publish(rows),1000);
  assert.equal(publish(structuredClone(rows)),0);
  rows[412].displayName='Updated';
  assert.equal(publish(rows),1);
  assert.deepEqual(sent[1],[rows[412]]);
  rows[412].avatarUrl='new-avatar';
  assert.equal(publish(rows),1);
  assert.equal(publish(rows),0);
});

test('failed pushes retry, reconnects publish a full baseline, and returning contacts are included',()=>{
  const a={jid:'a@s.whatsapp.net'},b={jid:'b@s.whatsapp.net'};
  let fail=true;const sent=[];
  const publish=createContactDeltaPublisher(rows=>{if(fail)throw Error('disk failed');sent.push(rows);});
  assert.throws(()=>publish([a,b]),/disk failed/);
  fail=false;
  assert.equal(publish([a,b]),2);
  assert.equal(publish([a]),0);
  assert.equal(publish([a,b]),1);
  assert.deepEqual(sent.at(-1),[b]);
  const reconnected=createContactDeltaPublisher(rows=>sent.push(rows));
  assert.equal(reconnected([a,b]),2);
});
