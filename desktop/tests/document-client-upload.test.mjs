import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {fileURLToPath} from 'node:url';
const src=fileURLToPath(new URL('../src',import.meta.url));
const mocks={'./baileysCore':"export const baileysStatus=async()=>globalThis.docStatus;export const request=async(path,init,account)=>{globalThis.docRequests.push({path,init,account});return {ok:true};};"};
const built=await build({entryPoints:[src+'/lib/baileysSend.ts'],bundle:true,write:false,format:'esm',platform:'node',alias:{'@':src},plugins:[{name:'doc-client',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {baileysSendDocument}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
test('original file and blob-cache retries use bounded binary upload with account and metadata',async()=>{
 globalThis.docStatus={connection:'connected',capabilities:{documentStream:true}};globalThis.docRequests=[];
 const file=new Blob([Buffer.alloc(20*1024*1024,7)],{type:'audio/mpeg'}),url=URL.createObjectURL(file);
 try{for(const input of [file,url])await baileysSendDocument('+15551234567',input,'Lecture.mp3',{accountId:'account-b',mimetype:'audio/mpeg'});
 for(const {path,init,account} of docRequests){assert.equal(path,'/send/document');assert.equal(account,'account-b');assert.ok(init.body instanceof Blob);const bytes=Buffer.from(await init.body.arrayBuffer()),length=bytes.readUInt32BE(0),meta=JSON.parse(bytes.subarray(4,length+4));assert.equal(meta.fileName,'Lecture.mp3');assert.equal(meta.size,file.size);assert.equal(bytes.length-4-length,file.size);assert.equal(bytes.at(-1),7);}
 }finally{URL.revokeObjectURL(url);}
});
test('old bridges and cancelled sends are rejected before uploading a large file',async()=>{
 docRequests.length=0;globalThis.docStatus={connection:'connected',capabilities:{}};
 await assert.rejects(baileysSendDocument('+15551234567',new Blob(['file']),'a.mp3'),/重启/);
 globalThis.docStatus.capabilities.documentStream=true;
 await assert.rejects(baileysSendDocument('+15551234567',new Blob(['file']),'a.mp3',{canSend:()=>false}),/取消/);
 assert.equal(docRequests.length,0);
});
