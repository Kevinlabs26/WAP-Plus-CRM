import fs from 'node:fs/promises';
const lock = await fs.readFile(new URL('./Cargo.lock', import.meta.url), 'utf8');
const packages = lock.split('[[package]]').slice(1).filter(p => p.includes('registry+')).map(p => ({
  name: p.match(/^name = "([^"]+)"/m)[1], version: p.match(/^version = "([^"]+)"/m)[1], ecosystem: 'crates.io',
}));
const results = [];
for (let i = 0; i < packages.length; i += 100) {
  const batch = packages.slice(i, i + 100);
  const response = await fetch('https://api.osv.dev/v1/querybatch', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queries: batch.map(p => ({ package: { name: p.name, ecosystem: p.ecosystem }, version: p.version })) }),
    signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`OSV HTTP ${response.status}`);
  const body = await response.json();
  body.results.forEach((r, j) => results.push({ ...batch[j], vulnerabilities: r.vulns || [] }));
}
await fs.writeFile(new URL('../osv-native-candidate.json', import.meta.url), JSON.stringify({ results }, null, 2) + '\n');
console.log(JSON.stringify({ scanned: results.length, findings: results.filter(p => p.vulnerabilities.length) }, null, 2));
