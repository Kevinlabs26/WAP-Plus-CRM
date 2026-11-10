import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {serialize} from 'node:v8';
import {encodeRawMessage,decodeRawMessage,decodeLegacyRawMessage} from '../baileys-bridge/rawMessageCodec.mjs';
const bun = resolve('node_modules/bun/bin', process.platform === 'win32' ? 'bun.exe' : 'bun');

test('portable protocol caches round-trip through Node and Bun, preserving binary data and large integers',()=>{
 const message={key:{id:'sample'},message:{audioMessage:{mediaKey:Buffer.alloc(32,7),waveform:new Uint8Array([1,2])}},count:123456789123456789n};
 const data=encodeRawMessage(message);
 assert.deepEqual(decodeRawMessage(data),message);
 const script="const c=require('./baileys-bridge/rawMessageCodec.mjs');const fs=require('node:fs');process.stdout.write(c.encodeRawMessage(c.decodeRawMessage(fs.readFileSync(0))));";
 const result=execFileSync(bun,['-e',script],{input:data,windowsHide:true,timeout:10000});
 assert.deepEqual(decodeRawMessage(result),message);
 assert.deepEqual(decodeRawMessage(serialize(message)),message,'same-runtime legacy caches remain readable');
});

test('a legacy Bun cache is migrated without losing keys when opened by Node',async()=>{
 const data=execFileSync(bun,['-e',"process.stdout.write(require('node:v8').serialize({key:{id:'legacy'},mediaKey:Buffer.alloc(32,9)}))"],{windowsHide:true,timeout:10000});
 const restored=await decodeLegacyRawMessage(data);
 assert.equal(restored.key.id,'legacy');assert.deepEqual(restored.mediaKey,Buffer.alloc(32,9));
});
