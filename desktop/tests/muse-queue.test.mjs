import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueMuseTask, museQueueSnapshot } from '../src/lib/museQueue.ts';

test('a running Muse request with no response times out and releases its account', async () => {
  let runningSignal;
  const stuck = enqueueMuseTask('text', signal => {
    runningSignal = signal;
    return new Promise(() => {});
  }, undefined, 0, 'timeout-test', 20);
  const next = enqueueMuseTask('text', async () => 'next', undefined, 0, 'timeout-test');
  await assert.rejects(stuck, /Muse 运行超时/);
  assert.equal(runningSignal.aborted, true);
  assert.equal(await next, 'next');
  assert.equal(museQueueSnapshot().textRunning, 0);
});

test('Muse queue preserves FIFO order for equal-priority work', async () => {
  const order = [];
  const first = enqueueMuseTask('text', async () => { order.push('first'); return 1; }, undefined, 1);
  const second = enqueueMuseTask('text', async () => { order.push('second'); return 2; }, undefined, 1);
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first', 'second']);
});
