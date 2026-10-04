import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Report locations only; never print suspected credential values.
const skipped = new Set(['.git', 'node_modules', '.audit-cache', '.gradle', '.kotlin', 'gen']);
const rules = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g],
  ['aws-access-key', /(?:AKIA|ASIA)[A-Z0-9]{16}/g],
  ['github-token', /gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}/g],
  ['google-key', /AIza[A-Za-z0-9_-]{35}/g],
  ['api-key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}/g],
  ['credential-url', /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|https?):\/\/[^\s/:"'<>]+:[^\s/@"'<>]+@/gi],
  ['webhook', /https:\/\/(?:hooks\.slack\.com\/services|discord(?:app)?\.com\/api\/webhooks)\/[^\s"'<>]+/gi],
];
const files = [];
const findings = [];
function findSecrets(source, location, output) {
  for (const [rule, pattern] of rules) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      output.push({ ...location, line: source.slice(0, match.index).split('\n').length, rule });
    }
  }
}
async function scan(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (skipped.has(entry.name) || entry.name.startsWith('target') || file === path.join('docs', 'security') || file.startsWith('%SystemDrive%')) continue;
      await scan(file);
      continue;
    }
    if (/\.(?:png|jpg|jpeg|ico|woff2?|zip|jar|class|onnx|db|pdf)$/i.test(file)) continue;
    const body = await fs.readFile(file);
    const source = body.toString('utf8');
    files.push({ file, bytes: body.length });
    findSecrets(source, { file }, findings);
  }
}
await scan('.');
await fs.mkdir('docs/security', { recursive: true });
await fs.writeFile('docs/security/secret-scan.json', JSON.stringify({ files, findings }, null, 2) + '\n');
console.log(JSON.stringify({ scanned: files.length, candidates: findings }, null, 2));
if (process.argv.includes('--history')) {
  const git = (...args) => execFileSync('git', args, { maxBuffer: 256 * 1024 * 1024 });
  const objects = git('rev-list', '--objects', '--all').toString('utf8').trim().split('\n');
  const metadata = execFileSync('git', ['cat-file', '--batch-check'], {
    input: objects.map(line => line.split(' ')[0]).join('\n') + '\n', maxBuffer: 32 * 1024 * 1024,
  }).toString('utf8').trim().split('\n');
  const historyFindings = [];
  const skippedBlobs = [];
  let blobs = 0;
  for (let i = 0; i < objects.length; i++) {
    const [oid, type, size] = metadata[i].split(' ');
    if (type !== 'blob') continue;
    const file = objects[i].slice(oid.length + 1);
    if (Number(size) > 32 * 1024 * 1024) {
      skippedBlobs.push({ oid, file, bytes: Number(size), reason: 'over 32 MiB' });
      continue;
    }
    const body = git('cat-file', 'blob', oid);
    blobs++;
    findSecrets(body.toString('utf8'), { oid, file }, historyFindings);
  }
  const result = { commits: Number(git('rev-list', '--all', '--count')), blobs, skippedBlobs, findings: historyFindings };
  await fs.writeFile('docs/security/secret-history-scan.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ historyCommits: result.commits, historyBlobs: blobs, skippedBlobs, candidates: historyFindings }, null, 2));
}
