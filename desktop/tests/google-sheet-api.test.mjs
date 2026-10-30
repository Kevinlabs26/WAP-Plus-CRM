import test from 'node:test';
import assert from 'node:assert/strict';
import { spreadsheetId, getSheetColumns } from '../src/lib/googleSheetApi.ts';

test('accepts only Google spreadsheet URLs or IDs', () => {
  assert.equal(spreadsheetId('https://docs.google.com/spreadsheets/d/abc-123/edit#gid=0'), 'abc-123');
  assert.equal(spreadsheetId('https://evil.example/spreadsheets/d/abc/edit'), null);
  assert.equal(spreadsheetId('abc_123'), 'abc_123');
});

test('reads only selected columns using authorization header and quotes tab names', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      const parsed = new URL(url);
      assert.deepEqual(parsed.searchParams.getAll('ranges'), ["'Client''s'!B:B", "'Client''s'!AA:AA"]);
      assert.equal(options.headers.Authorization, 'Bearer token');
      assert.equal(parsed.search.includes('token'), false);
      return {ok:true, json:async()=>({valueRanges:[{values:[['Phone','+12025550100']]},{values:[['Order','A']]}]})};
    };
    assert.deepEqual(await getSheetColumns('abc', "Client's", [1,26], 'token'), [['Phone','+12025550100'], ['Order','A']]);
    await assert.rejects(getSheetColumns('abc', 'tab', [-1], 'token'));
  } finally { globalThis.fetch = original; }
});
