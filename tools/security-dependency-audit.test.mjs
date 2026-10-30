import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('dependency audit uses current Gradle locks, not obsolete dependency logs', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bridge-audit-'));
  try {
    const files = {
      'package.json': '{}',
      'desktop/package.json': '{}',
      'desktop/baileys-bridge/package.json': '{}',
      'package-lock.json': '{"packages":{}}',
      'desktop/package-lock.json': '{"packages":{}}',
      'desktop/baileys-bridge/package-lock.json': '{"packages":{}}',
      'desktop/src-tauri/Cargo.toml': '',
      'desktop/src-tauri/Cargo.lock': '',
      'android/buildscript-gradle.lockfile': '',
      'android/app/gradle.lockfile': 'com.google.guava:guava:33.7.2-jre=tooling\n',
      'docs/security/android-build-dependencies.log': '+--- com.google.guava:guava:32.0.1-jre\n',
    };
    for (const [name, content] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(dir, name)), { recursive: true });
      await fs.writeFile(path.join(dir, name), content);
    }
    execFileSync(process.execPath, [fileURLToPath(new URL('./security-dependency-audit.mjs', import.meta.url))], { cwd: dir });
    const result = JSON.parse(await fs.readFile(path.join(dir, 'docs/security/dependency-inventory.json'), 'utf8'));
    assert.deepEqual(result.packages.map(p => [p.name, p.version]), [['com.google.guava:guava', '33.7.2-jre']]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
