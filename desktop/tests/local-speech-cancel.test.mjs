import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const mocks={
 '@tauri-apps/api/core':'export const invoke=(...args)=>globalThis.nativeVoiceInvoke(...args);',
 '@/lib/mediaBlob':'export const mediaUrlToBlob=async()=>new Blob(["audio"]);',
};
const built=await build({entryPoints:[fileURLToPath(new URL('../src/lib/localSpeech.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',alias:{'@':fileURLToPath(new URL('../src',import.meta.url))},plugins:[{name:'native-speech',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {localTranscribe}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));

test('cancelled native inference finishes once, reuses its result and serializes another voice',async()=>{
 const previous={AudioContext:globalThis.AudioContext,OfflineAudioContext:globalThis.OfflineAudioContext};
 globalThis.AudioContext=class {async decodeAudioData(){return {duration:0.01};}async close(){}};
 globalThis.OfflineAudioContext=class {destination={};createBufferSource(){return {connect(){},start(){}};}async startRendering(){return {getChannelData:()=>new Float32Array([0.1,0.2])};}};
 let calls=0,release;
 globalThis.nativeVoiceInvoke=async cmd=>{assert.equal(cmd,'speech_transcribe');calls++;return new Promise(resolve=>{release=resolve;});};
 try{
  const controller=new AbortController(),opts={mediaUrl:'voice-a',model:'tiny'};
  const cancelled=localTranscribe({...opts,signal:controller.signal});while(!release)await new Promise(resolve=>setImmediate(resolve));
  controller.abort();await assert.rejects(cancelled,/abort/i);
  const reused=localTranscribe(opts);assert.equal(calls,1);
  const secondController=new AbortController(),waiting=localTranscribe({mediaUrl:'voice-b',model:'tiny',signal:secondController.signal});
  secondController.abort();await assert.rejects(waiting,/abort/i);assert.equal(calls,1,'another native inference cannot overlap');
  release({text:' bonjour '});assert.equal(await reused,'bonjour');assert.equal(await localTranscribe(opts),'bonjour');assert.equal(calls,1);
  globalThis.nativeVoiceInvoke=async()=>{calls++;return {text:'salut'};};
  assert.equal(await localTranscribe({...opts,language:'fr'}),'salut');assert.equal(calls,2,'language changes do not reuse a different decoding result');
 }finally{Object.assign(globalThis,previous);delete globalThis.nativeVoiceInvoke;}
});
