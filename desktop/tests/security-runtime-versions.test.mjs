import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ffmpegBinary } from '../baileys-bridge/audioConvert.mjs';

const version = raw => {
  assert.match(raw, /^\d+\.\d+\.\d+$/);
  return raw.split('.').map(Number);
};
const atLeast = (current, minimum) => {
  for (let i = 0; i < 3; i++) if (current[i] !== minimum[i]) return current[i] > minimum[i];
  return true;
};

test('Windows media conversion uses the pinned project FFmpeg rather than PATH', { skip: process.platform !== 'win32' }, async () => {
  assert.match(ffmpegBinary, /ffmpeg-x86_64-pc-windows-msvc\.exe$/);
  const hash = createHash('sha256').update(await readFile(ffmpegBinary)).digest('hex');
  assert.equal(hash, '3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec');
  const version = spawnSync(ffmpegBinary, ['-version'], { windowsHide: true, encoding: 'utf8' });
  assert.equal(version.status, 0);
  assert.match(version.stdout, /^ffmpeg version 9\.0\.2/);
});

test('Bun compiler and CI Node pins include the October 2026 runtime security fixes', async () => {
  const pkg = JSON.parse(await readFile(new URL('../baileys-bridge/package.json', import.meta.url), 'utf8'));
  assert.ok(atLeast(version(pkg.devDependencies.bun), [1, 4, 4]), 'Bun compiler embeds its runtime in the shipped sidecar');
  for (const file of ['../../package-lock.json', '../baileys-bridge/package-lock.json']) {
    const lock = JSON.parse(await readFile(new URL(file, import.meta.url), 'utf8'));
    const buns = Object.entries(lock.packages).filter(([key]) => /(?:^|\/)node_modules\/(?:bun|@oven\/bun-[^/]+)$/.test(key));
    assert.ok(buns.length > 1);
    for (const [key, value] of buns) assert.ok(atLeast(version(value.version), [1, 4, 4]), key);
  }
  const node = (await readFile(new URL('../../.nvmrc', import.meta.url), 'utf8')).trim();
  assert.ok(atLeast(version(node), [22, 23, 4]));
  const wrapper = await readFile(new URL('../../android/gradle/wrapper/gradle-wrapper.properties', import.meta.url), 'utf8');
  const gradle = /gradle-(\d+\.\d+\.\d+)-bin\.zip/.exec(wrapper)?.[1];
  assert.ok(atLeast(version(gradle || ''), [8, 14, 6]));
  if (gradle === '8.14.6') assert.match(wrapper, /distributionSha256Sum=7988ed071b2a07900e2ec715fca15c6ab72bce6db433af301fa7fa7e9407bd24/);
});
