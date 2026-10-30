import test from 'node:test';
import assert from 'node:assert/strict';
import { sheetErrorHint } from '../src/lib/googleSheetErrors.ts';
test('Google errors produce appropriate recovery guidance without treating every failure as authorization expiry',()=>{
 for(const [error,kind] of [
  ['Google request failed (401)','authorize'],['Google request failed (403)','forbidden'],
  ['Google request failed (404)','notFound'],['Google request failed (429)','quota'],
  ['Column headings changed or are duplicated','mapping'],['Google request failed (400)','request'],
  ['Google authorization was declined','cancelled'],['Google login timed out','timeout'],
  ['Cannot read Google Sheets; check your connection','network'],['QuotaExceededError: disk full','storage'],
  ['Google login is not configured in this build','build'],['Google request failed (503)','service'],
  ['Google authorization is already running','busy'],['unexpected error','other'],
 ]) assert.equal(sheetErrorHint(error),`sheets.error.${kind}`,error);
});
