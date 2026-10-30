import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const script=fileURLToPath(new URL('../../.github/scripts/prepare-google-client.mjs',import.meta.url));
test('release configuration fails closed for missing or web credentials and never prints credential contents',()=>{
 const dir=mkdtempSync(join(tmpdir(),'wap-google-release-'));
 const envFile=join(dir,'github-env');
 const secret='fictional-release-secret';
 const run=raw=>spawnSync(process.execPath,['--experimental-strip-types',script],{encoding:'utf8',env:{...process.env,RUNNER_TEMP:dir,GITHUB_ENV:envFile,GOOGLE_DESKTOP_CLIENT_JSON:raw}});
 try {
  for(const raw of ['', '{bad json', JSON.stringify({web:{client_id:'example.apps.googleusercontent.com',client_secret:secret}})]) {
   const result=run(raw);assert.notEqual(result.status,0);assert.equal(existsSync(envFile),false);
   assert.ok(!(result.stdout+result.stderr).includes(secret));
  }
  const raw=JSON.stringify({installed:{client_id:'example.apps.googleusercontent.com',client_secret:secret}});
  const result=run(raw);assert.equal(result.status,0,result.stderr);
  assert.equal(readFileSync(join(dir,'wap-google-desktop-client.json'),'utf8'),raw);
  assert.match(readFileSync(envFile,'utf8'),/WAP_REQUIRE_GOOGLE_CLIENT=1/);
  assert.ok(!(result.stdout+result.stderr).includes(secret));
 }finally{for(const path of [envFile,join(dir,'wap-google-desktop-client.json')])if(existsSync(path))unlinkSync(path);rmdirSync(dir);}
});
