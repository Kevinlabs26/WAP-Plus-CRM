import test from 'node:test';
import assert from 'node:assert/strict';
import { sheetPhone, sheetInternationalPhone, sheetColumnIndex, matchingSheetRows, selectedSheetValues, sheetRefreshDue } from '../src/lib/googleSheetMatch.ts';

test('phone matching requires a real number and never interprets a WhatsApp LID as a phone', () => {
  assert.equal(sheetInternationalPhone('  +33 6 12 34 56 78  '), '+33612345678');
  assert.equal(sheetInternationalPhone(' 33612345678 '), '+33612345678');
  assert.equal(sheetInternationalPhone('12025550100@lid'), null);
  assert.equal(sheetPhone('+1 (202) 555-0100'), '+12025550100');
  assert.equal(sheetPhone('202-555-0100', 'US'), '+12025550100');
  assert.equal(sheetPhone('202-555-0100'), null);
  assert.equal(sheetPhone('12025550100@lid'), null);
  const rows = [['+1 202 555 0100'], ['+33 1 42 68 53 00'], ['+12025550100']];
  assert.deepEqual(matchingSheetRows(rows, 0, '+12025550100'), [0, 2]);
  assert.deepEqual(matchingSheetRows(rows.reverse(), 0, '+12025550100'), [0, 2]);
});

test('headings must remain unique when a column moves or is renamed', () => {
  assert.equal(sheetColumnIndex(['Name', 'Phone', 'Order'], 'Phone'), 1);
  assert.equal(sheetColumnIndex(['Phone', 'Name', 'Order'], 'Phone'), 0);
  assert.equal(sheetColumnIndex(['Name', 'Telephone'], 'Phone'), null);
  assert.equal(sheetColumnIndex(['Phone', 'Phone'], 'Phone'), null);
});

test('returns only selected fields for every matching row and rejects ambiguous mappings', () => {
  const headers = ['Name', 'Phone', 'Order', 'Notes'];
  const rows = [['Ana', '+12025550100', 'A', 'private'], ['Ada', '+12025550100', 'B', 'private']];
  assert.deepEqual(selectedSheetValues(headers, rows, {heading:'Phone'}, [{heading:'Order'}, {heading:'Name'}], '+12025550100'), [['A', 'Ana'], ['B', 'Ada']]);
  assert.deepEqual(selectedSheetValues([], rows, {position:1}, [{position:2}], '+12025550100'), [['A'], ['B']]);
  assert.equal(selectedSheetValues(['Name', 'Phone', 'Order', 'Order'], rows, {heading:'Phone'}, [{heading:'Order'}], '+12025550100'), null);
});

test('each field follows its own interval, local daily time, or manual schedule', () => {
  const now = new Date(2026, 9, 29, 10, 0);
  const last = new Date(2026, 9, 29, 8, 0).getTime();
  assert.equal(sheetRefreshDue({ kind: 'interval', minutes: 30 }, last, now), true);
  assert.equal(sheetRefreshDue({ kind: 'interval', minutes: 180 }, last, now), false);
  assert.equal(sheetRefreshDue({ kind: 'daily', time: '09:00' }, last, now), true);
  assert.equal(sheetRefreshDue({ kind: 'daily', time: '11:00' }, last, now), false);
  assert.equal(sheetRefreshDue({ kind: 'manual' }, null, now), false);
  assert.equal(sheetRefreshDue({ kind: 'daily', time: '25:00' }, null, now), false);
  assert.equal(sheetRefreshDue({ kind: 'interval', minutes: 0 }, null, now), false);
});
