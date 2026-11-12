import test from 'node:test';
import assert from 'node:assert/strict';

const runtime = await import('../src/lib/appLockRuntime.ts');

test('app lock runtime exposes the current automation pause state', () => {
  runtime.setAppLockActive(false);
  assert.equal(runtime.isAppLockActive(), false);
  runtime.setAppLockActive(true);
  assert.equal(runtime.isAppLockActive(), true);
  runtime.setAppLockActive(false);
});
