import fs from 'node:fs/promises';

// Read manifests/locks without executing dependency install scripts.
const manifests = ['package.json', 'desktop/package.json', 'desktop/baileys-bridge/package.json'];
const locks = ['package-lock.json', 'desktop/package-lock.json', 'desktop/baileys-bridge/package-lock.json'];
const npm = [];
const direct = [];
for (const file of locks) {
  const lock = JSON.parse(await fs.readFile(file, 'utf8'));
  for (const [path, pkg] of Object.entries(lock.packages || {})) {
    if (!path.includes('node_modules/') || !pkg.version) continue;
    npm.push({ ecosystem: 'npm', name: path.split('node_modules/').at(-1), version: pkg.version, file, path });
  }
}
for (const file of manifests) {
  const pkg = JSON.parse(await fs.readFile(file, 'utf8'));
  for (const scope of ['dependencies', 'devDependencies']) {
    for (const [name, range] of Object.entries(pkg[scope] || {})) {
      const local = file.replace('/package.json', '') + '/node_modules/' + name;
      const resolved = npm.find(p => p.file === 'package-lock.json' && p.path === local)
        || npm.find(p => p.file === 'package-lock.json' && p.path === 'node_modules/' + name);
      direct.push({ file, scope, name, range, version: resolved?.version });
    }
  }
}
const cargo = await fs.readFile('desktop/src-tauri/Cargo.lock', 'utf8');
const rust = cargo.split('[[package]]').slice(1).flatMap(block => {
  const name = block.match(/^name = "([^"]+)"/m)?.[1];
  const version = block.match(/^version = "([^"]+)"/m)?.[1];
  return name && version && block.includes('registry+')
    ? [{ ecosystem: 'crates.io', name, version, file: 'desktop/src-tauri/Cargo.lock' }] : [];
});
const android = [];
for (const file of ['android/buildscript-gradle.lockfile', 'android/app/gradle.lockfile']) {
  const lock = await fs.readFile(file, 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return '';
  });
  for (const line of lock.split('\n')) {
    const match = line.match(/^([^:#=]+):([^:=]+):([^=]+)=(.*)/);
    if (match) android.push({ ecosystem: 'Maven', name: `${match[1]}:${match[2]}`, version: match[3], file, configurations: match[4].trim().split(',') });
  }
}
for (const file of ['docs/security/android-dependencies.log', 'docs/security/android-build-dependencies.log']) {
  const androidTree = await fs.readFile(file, 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return '';
  });
  for (const line of androidTree.split('\n')) {
    const match = line.match(/--- ([\w.-]+):([\w.-]+)(?::([^\s]+))?(?: -> ([^\s]+))?/);
    if (!match) continue;
    let name = `${match[1]}:${match[2]}`;
    let version = match[4] || match[3];
    // Gradle prints rich constraints separately; resolved coordinates occur in the same tree.
    if (version?.startsWith('{')) continue;
    if (version?.includes(':')) {
      const resolved = version.split(':');
      name = resolved.slice(0, 2).join(':');
      version = resolved[2];
    }
    if (!version || version.includes('FAILED')) throw new Error(`Unresolved Android dependency: ${name}`);
    android.push({ ecosystem: 'Maven', name, version, file });
  }
}
const packages = [...new Map([...npm, ...rust, ...android].map(p => [`${p.ecosystem}:${p.name}:${p.version}`, p])).values()];
const cargoManifest = await fs.readFile('desktop/src-tauri/Cargo.toml', 'utf8');
const rustDirect = [];
let section = '';
for (const line of cargoManifest.split('\n')) {
  if (line.trim().startsWith('[')) section = line.trim();
  if (!section.includes('dependencies]')) continue;
  const match = line.match(/^([\w-]+)\s*=\s*(.*)/);
  if (match) rustDirect.push({ name: match[1], declaration: match[2].trim(), section, versions: rust.filter(p => p.name === match[1]).map(p => p.version) });
}
const inventory = { direct, rustDirect, npm, rust, android, packages };
await fs.mkdir('docs/security', { recursive: true });
await fs.writeFile('docs/security/dependency-inventory.json', JSON.stringify(inventory, null, 2) + '\n');
console.log(`Inventory: ${direct.length} direct npm declarations, ${packages.length} unique resolved name/version/ecosystem tuples (${packages.filter(p => p.ecosystem === 'Maven').length} Maven)`);
if (!process.argv.includes('--online')) process.exit(0);
const results = [];
for (let i = 0; i < packages.length; i += 100) {
  const batch = packages.slice(i, i + 100);
  const response = await fetch('https://api.osv.dev/v1/querybatch', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queries: batch.map(p => ({ package: { name: p.name, ecosystem: p.ecosystem }, version: p.version })) }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`OSV HTTP ${response.status}`);
  const body = await response.json();
  body.results.forEach((r, j) => results.push({ ...batch[j], vulnerabilities: r.vulns || [] }));
}
const advisories = [];
const ids = [...new Set(results.flatMap(r => r.vulnerabilities.map(v => v.id)))];
for (const id of ids) {
  const response = await fetch(`https://api.osv.dev/v1/vulns/${id}`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`OSV ${id}: HTTP ${response.status}`);
  advisories.push(await response.json());
}
const maintenance = [];
for (const p of direct) {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(p.name)}`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Registry ${p.name}: HTTP ${response.status}`);
  const body = await response.json();
  maintenance.push({ name: p.name, version: p.version, repository: body.repository, deprecated: body.versions?.[p.version]?.deprecated, published: body.time?.[p.version], modified: body.time?.modified, latest: body['dist-tags']?.latest });
}
await fs.writeFile('docs/security/osv-audit.json', JSON.stringify({ results, advisories, maintenance }, null, 2) + '\n');
console.log(JSON.stringify(results.filter(r => r.vulnerabilities.length), null, 2));
