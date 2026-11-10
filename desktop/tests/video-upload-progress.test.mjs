import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const built=await build({entryPoints:[fileURLToPath(new URL('../src/lib/baileysCore.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',alias:{'@':fileURLToPath(new URL('../src',import.meta.url))}});
const {uploadWithProgress}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
test('upload reports real bytes and waits for the response after the upload reaches 100%',async()=>{
 const original=globalThis.XMLHttpRequest;let xhr;
 globalThis.XMLHttpRequest=class{upload={};headers={};constructor(){xhr=this;}open(method,url){this.method=method;this.url=url;}setRequestHeader(key,value){this.headers[key]=value;}send(body){this.body=body;}abort(){this.onabort();}};
 try{
  const values=[],body=new Blob(['12345678']);let complete=false;
  const response=uploadWithProgress('http://127.0.0.1/send/video',{method:'POST',headers:{'X-Wap-Token':'fixture'},body},(loaded,total)=>values.push([loaded,total])).then(value=>{complete=true;return value;});
  xhr.upload.onprogress({lengthComputable:false,loaded:1,total:0});
  xhr.upload.onprogress({lengthComputable:true,loaded:4,total:8});xhr.upload.onload();await Promise.resolve();
  assert.deepEqual(values,[[0,8],[4,8],[8,8]]);assert.equal(complete,false);assert.equal(xhr.headers['x-wap-token'],'fixture');
  xhr.status=200;xhr.responseText='{"ok":true}';xhr.onload();assert.deepEqual(await (await response).json(),{ok:true});
 }finally{globalThis.XMLHttpRequest=original;}
});
test('abort interrupts upload and never returns a successful response',async()=>{
 const original=globalThis.XMLHttpRequest;let aborted=false;
 globalThis.XMLHttpRequest=class{upload={};open(){}setRequestHeader(){}send(){}abort(){aborted=true;this.onabort();}};
 try{const controller=new AbortController();const pending=uploadWithProgress('http://127.0.0.1/send/video',{body:new Blob(['video']),signal:controller.signal});controller.abort();await assert.rejects(pending,error=>error.name==='AbortError');assert.equal(aborted,true);}finally{globalThis.XMLHttpRequest=original;}
});
