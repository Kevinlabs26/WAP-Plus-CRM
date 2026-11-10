import test from 'node:test';
import assert from 'node:assert/strict';
import {encryptPortableBackup,decryptPortableBackup} from '../src/lib/portableBackup.ts';
const password='a long test password 42';
const sample={version:2,app:'WAP Plus CRM',messages:[{id:'one',body:'PRIVATE_CHAT_TEXT_测试'}]};
test('portable backups encrypt content, use fresh salts and restore independently of Windows credentials',async()=>{
 const first=await encryptPortableBackup(sample,password),second=await encryptPortableBackup(sample,password);
 assert.equal((await first.text()).includes('PRIVATE_CHAT_TEXT'),false);
 assert.notDeepEqual(new Uint8Array(await first.arrayBuffer()),new Uint8Array(await second.arrayBuffer()));
 assert.deepEqual(await decryptPortableBackup(first,password),sample);
 assert.deepEqual(await decryptPortableBackup(second,password),sample);
});
test('wrong passwords, changed ciphertext, invalid headers and weak passwords cannot produce a restore payload',async()=>{
 await assert.rejects(()=>encryptPortableBackup(sample,'short'));
 const blob=await encryptPortableBackup(sample,password);
 await assert.rejects(()=>decryptPortableBackup(blob,'a wrong but long password'),/密码不正确/);
 const changed=new Uint8Array(await blob.arrayBuffer());changed[changed.length-1]^=1;
 await assert.rejects(()=>decryptPortableBackup(new Blob([changed]),password),/损坏/);
 changed[0]^=1;await assert.rejects(()=>decryptPortableBackup(new Blob([changed]),password),/不是支持/);
 await assert.rejects(()=>decryptPortableBackup(new Blob(['{}']),password),/大小无效/);
});
