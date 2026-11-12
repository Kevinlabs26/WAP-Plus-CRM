import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueMuseTask } from '../src/lib/museQueue.ts';

test('Muse queue preserves FIFO order for equal-priority work', async () => {
  const order = [];
  const first = enqueueMuseTask('text', async () => { order.push('first'); return 1; }, undefined, 1);
  const second = enqueueMuseTask('text', async () => { order.push('second'); return 2; }, undefined, 1);
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first', 'second']);
});
