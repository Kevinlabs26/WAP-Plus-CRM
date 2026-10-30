import test from 'node:test';
import assert from 'node:assert/strict';
import { donationAvailable } from '../src/lib/githubStars.ts';

test('donations appear only above 1000 GitHub stars and failures stay hidden', async () => {
 const original = globalThis.fetch;
 try {
  for (const [count, expected] of [[999,false],[1000,false],[1001,true],['1001',false],[null,false]]) {
   globalThis.fetch = async (url) => { assert.equal(url, 'https://api.github.com/repos/Kevinlabs26/WAP-Plus-CRM'); return { ok:true, json:async()=>({stargazers_count:count}) }; };
   assert.equal(await donationAvailable(), expected);
  }
  globalThis.fetch = async () => ({ok:false});
  assert.equal(await donationAvailable(), false);
  globalThis.fetch = async () => { throw new Error('offline'); };
  assert.equal(await donationAvailable(), false);
 } finally { globalThis.fetch = original; }
});
