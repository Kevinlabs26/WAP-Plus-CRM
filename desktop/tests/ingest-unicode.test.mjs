import test from 'node:test';
import assert from 'node:assert/strict';
import {ingestString} from '../src/store/bridgeIngestHelpers.ts';

test('ingest length limits never leave half an emoji at the truncation boundary',()=>{
  assert.equal(ingestString('a😀b',2),'a');
  assert.equal(ingestString('a😀b',3),'a😀');
  assert.equal(ingestString('😀',1),'');
  assert.equal(ingestString('😀',2),'😀');
  assert.equal(ingestString(' 中😀文 ',4),'中😀文');
  assert.equal(ingestString('abc',0),'');
});
