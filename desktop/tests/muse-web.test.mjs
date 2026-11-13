import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

const driver=await readFile(new URL('../src-tauri/src/muse_web_driver.js',import.meta.url),'utf8');
function page({fetchMedia=async()=>new Response('image',{headers:{'Content-Type':'image/png'}}),fileInput=false,attachmentMode='retain',uploadBusy=false,hiddenStop=false,multiple=true}={}){
 let now=1000,running=false,clicks=0,notice='',items=[],hydration='hydrated',hasInput=true,hiddenAnchor;
 let previews=[],removes=[],uploadError='',uploadedFile,attachedFiles=[];
 class Textarea {get value(){return this.text||'';}set value(value){this.text=value;}dispatchEvent(){}offsetParent={};}
 const field=new Textarea();
 const composer={parentElement:null,contains:()=>false,get innerText(){return previews.length?'bridgecrm-reference.jpg':'';},querySelectorAll(selector){if(selector==='img')return previews;if(selector==='button,[role="button"]')return removes;if(selector==='[role="progressbar"],[aria-busy="true"]')return uploadBusy?[{offsetParent:{}}]:[];if(selector==='[role="alert"]')return uploadError?[{offsetParent:{},innerText:uploadError}]:[];if(selector==='textarea')return[field];return[];}};
 field.parentElement=composer;
 const removeReference=()=>{previews=[];removes=[];fileField.files=[];};
 const showReference=()=>{previews=[{offsetParent:{},currentSrc:'blob:https://muse.ai/reference'}];removes=[{offsetParent:{},getAttribute:key=>key==='aria-label'?'Remove attachment':null,click:removeReference}];};
 let fileField={files:[],multiple,isConnected:true,getAttribute:()=> 'image/*',dispatchEvent(event){if(event.type!=='change'||!this.files.length)return;uploadedFile=this.files[0];if(attachmentMode==='error'){uploadError='Image upload failed';return;}if(attachmentMode==='multi'){attachedFiles.push(...this.files);previews=attachedFiles.map((_,i)=>({offsetParent:{},currentSrc:'blob:https://muse.ai/reference-'+i}));removes=attachedFiles.map(()=>({offsetParent:{},getAttribute:key=>key==='aria-label'?'Remove attachment':null,click:removeReference}));}else if(attachmentMode!=='none')showReference();if(attachmentMode==='clear')this.files=[];if(attachmentMode==='replace'){this.isConnected=false;fileField={...this,files:[],isConnected:true};}}};
 class Transfer {constructor(){this.files=[];this.items={add:file=>this.files.push(file)};}}
 const location={origin:'https://muse.ai',hostname:'muse.ai',href:'https://muse.ai/thread/new?wapRequest=job-1',pathname:'/thread/new',search:'?wapRequest=job-1'};
 const bubble=(text,agent=false,media=[])=>({innerText:text,textContent:text,media,className:agent?'hatch-chat-groupable-bubble hatch-agent-bubble-bg':'hatch-chat-groupable-bubble hatch-user-bubble-bg',querySelectorAll:selector=>selector==='.prose'?agent&&text?[{innerText:text}]:[]:media.filter(item=>item.tag===selector)});
 const send={offsetParent:{},disabled:false,getAttribute:key=>key==='aria-label'?'Send':null,click(){clicks++;items.push(bubble(field.value));field.value='';running=true;if(location.pathname==='/thread/new')location.pathname='/thread/new-id';}};
 const stop={get offsetParent(){return running?{}:null;},click(){running=false;}};
 const document={body:{get innerText(){return notice+'\n'+items.map(b=>b.innerText).join('\n');}},
  querySelector(selector){if(selector.includes('hydration'))return{getAttribute:()=> hydration};if(selector.includes('stop-button'))return running?stop:null;return null;},
  querySelectorAll(selector){if(selector.includes('stop-button'))return running||hiddenStop?[stop]:[];if(selector==='textarea')return hasInput?[field]:[];if(selector==='input[type="file"]')return fileInput?[fileField]:[];if(selector.startsWith('button'))return[send];if(selector.includes('groupable-bubble'))return items;return[];}};
 class Reader {readAsDataURL(){this.result='data:image/png;base64,aW1hZ2U=';this.onload();}}
 const context=vm.createContext({window:{},document,location,HTMLTextAreaElement:Textarea,Event:class{constructor(type){this.type=type;}},URLSearchParams,URL,AbortSignal,FileReader:Reader,Blob,File,DataTransfer:Transfer,atob,fetch:fetchMedia,Date:{now:()=>now}});
 vm.runInContext(driver,context);
 return {get api(){return context.window.__wapMuse;},field,get fileField(){return fileField;},get uploadedFile(){return uploadedFile;},hideAnchor(){hiddenAnchor=items.shift();},restoreAnchor(){items.unshift(hiddenAnchor);},hideAnchorText(){items[0].innerText="";},siblingImageLayout(){const reply=items.findLast(b=>b.className.includes('hatch-agent'));const anchor=items[0];const next=bubble('Later manual request');next.order=4;items.push(next);const image=(order,src)=>({tagName:'IMG',querySelectorAll:()=>[],order,currentSrc:src,naturalWidth:1024,naturalHeight:1024,closest:()=>null,compareDocumentPosition:other=>other.order>order?4:2});const media=[image(1,'https://muse.ai/user-reference.png'),image(5,'https://muse.ai/another-turn.png'),image(3,'https://muse.ai/sibling-result.png')];const root={parentElement:null,contains:node=>node===anchor||node===reply,querySelectorAll:()=>media};reply.parentElement=root;reply.order=2;reply.contains=()=>false;reply.compareDocumentPosition=other=>other.order>2?4:2;},showReference,removeReference,setUploadBusy(value){uploadBusy=value;},get previews(){return previews;},send,location,get clicks(){return clicks;},tick(ms){now+=ms;},reply(text){items.push(bubble(text,true));},image(src='https://muse.ai/generated.png',agent=true){const media={tag:'img',naturalWidth:1024,naturalHeight:1024,currentSrc:src};if(agent)items.push(bubble('',true,[media]));else items.at(-1).media.push(media);},attachment(href){items.push(bubble('',true,[{tag:'a[download][href]',href,getAttribute:()=> 'generated.png'}]));},finish(){running=false;},setNotice(text){notice=text;},setHydration(value){hydration=value;},setInputVisible(value){hasInput=value;},replaceThread(){items=[bubble('A different contact prompt'),bubble('Wrong reply',true)];},old(){items.push(bubble('old history'));},reload(){delete context.window.__wapMuse;vm.runInContext(driver,context);}};
}

const referenceImage={mimeType:'image/jpeg',dataUrl:'data:image/jpeg;base64,aW1hZ2U='};
test('two input photos are confirmed in order with batch and sequential file inputs',()=>{
 for(const multiple of [true,false]){
  const p=page({fileInput:true,attachmentMode:'multi',multiple});
  assert.equal(p.api.start('job-1','Place subject 1 into layout 2',null,null,[referenceImage,referenceImage],true).state,'attaching');
  if(!multiple)assert.equal(p.api.poll('job-1').state,'attaching');
  assert.equal(p.api.poll('job-1').state,'generating');assert.equal(p.previews.length,2);assert.equal(p.clicks,1);
 }
 const tooMany=page({fileInput:true});assert.equal(tooMany.api.start('job-1','Draw',null,null,[referenceImage,referenceImage,referenceImage],true).state,'error');assert.equal(tooMany.clicks,0);
});
test('a hidden stop control does not keep a completed generation busy',()=>{
 const p=page({hiddenStop:true});assert.equal(p.api.inspect().state,'ready');p.api.start('job-1','Hello');p.api.poll('job-1');p.reply('Done');p.finish();p.api.poll('job-1');p.tick(2000);assert.equal(p.api.poll('job-1').state,'done');
});
test('a sibling image card is collected only between the assistant reply and the next user turn',async()=>{
 const urls=[];const p=page({fetchMedia:async url=>{urls.push(url);return new Response('image',{headers:{'Content-Type':'image/png'}});}});
 p.api.start('job-1','Draw',null,null,null,true);p.api.poll('job-1');p.reply('Here is your image');p.siblingImageLayout();p.finish();p.api.poll('job-1');
 await new Promise(resolve=>setImmediate(resolve));p.tick(2000);assert.equal(p.api.poll('job-1').state,'done');assert.deepEqual(urls,['https://muse.ai/sibling-result.png']);
});
test('a hanging media download has a bounded stage timeout',()=>{
 const p=page({fetchMedia:()=>new Promise(()=>{})});p.api.start('job-1','Draw',null,null,null,true);p.api.poll('job-1');p.image();p.finish();p.api.poll('job-1');p.tick(35_001);
 assert.match(p.api.poll('job-1').error,/图片已定位.*读取附件超时/);assert.equal(p.clicks,1);
});

test('oversized media is cancelled before buffering the complete response, including missing or false lengths',async()=>{
 for(const declared of [null,'1',String(8*1024*1024+1)]){
  let reads=0,cancelled=false,released=false;
  const reader={async read(){reads++;return{done:false,value:new Uint8Array(8*1024*1024+1)};},async cancel(){cancelled=true;},releaseLock(){released=true;}};
  const p=page({fetchMedia:async()=>({ok:true,headers:new Headers(declared?{'content-length':declared}:{}),body:{getReader:()=>reader,async cancel(){cancelled=true;}},blob:async()=>{throw Error('unbounded blob() must not be used');}})});
  p.api.start('job-1','Draw',null,null,null,true);p.api.poll('job-1');p.image();p.finish();p.api.poll('job-1');
  await new Promise(resolve=>setImmediate(resolve));p.tick(2000);
  assert.match(p.api.poll('job-1').error,/超过大小限制/);assert.equal(cancelled,true);
  assert.equal(reads,declared===String(8*1024*1024+1)?0:1);if(reads)assert.equal(released,true);
 }
});
test('retrieving an existing text-only result reports a specific failure after thirty seconds',()=>{
 const p=page(),id='21b90bdd-6442-420b-97ad-e6ffc25f3e07';p.location.search='?wapRequest='+id;p.api.start(id,'Draw');p.api.poll(id);p.reply('Here is the description');p.finish();p.api.poll(id);p.tick(2000);p.api.poll(id);p.reload();p.api.collect();p.tick(30_001);
 assert.match(p.api.poll(id).error,/取回超时.*未在本次回复范围/);assert.equal(p.clicks,1);
});
test('temporary rerendering of the request anchor waits without taking unrelated media',async()=>{
 const p=page();p.api.start('job-1','Draw',null,null,null,true);p.api.poll('job-1');p.hideAnchor();p.image();p.finish();
 assert.equal(p.api.poll('job-1').state,'generating');p.tick(5000);assert.equal(p.api.poll('job-1').media,undefined);
 p.restoreAnchor();p.api.poll('job-1');await new Promise(resolve=>setImmediate(resolve));p.tick(2000);
 assert.equal(p.api.poll('job-1').state,'done');assert.equal(p.clicks,1);
});
test('hidden request text remains verifiable through textContent',()=>{
 const p=page();p.api.start('job-1','Draw');p.api.poll('job-1');p.hideAnchorText();p.reply('Done');p.finish();p.api.poll('job-1');p.tick(2000);
 assert.equal(p.api.poll('job-1').state,'done');assert.equal(p.clicks,1);
});
test('a generated image can be retrieved after driver reload without clicking send again',async()=>{
 const p=page(),id='21b90bdd-6442-420b-97ad-e6ffc25f3e07';p.location.search='?wapRequest='+id;
 p.api.start(id,'Draw',null,null,null,true);p.api.poll(id);p.image();p.finish();p.api.poll(id);
 await new Promise(resolve=>setImmediate(resolve));p.tick(2000);assert.equal(p.api.poll(id).state,'done');
 p.reload();const output=p.api.collect();assert.equal(output.requestId,id);
 await new Promise(resolve=>setImmediate(resolve));p.tick(2000);assert.equal(p.api.poll(id).media.mimeType,'image/png');assert.equal(p.clicks,1);
});
test('retrieval refuses unmarked conversations instead of taking arbitrary images',()=>{
 const p=page();p.location.pathname='/thread/manual';p.old();p.image();assert.equal(p.api.collect().state,'error');assert.equal(p.clicks,0);
});
test('reference confirmation survives a cleared or replaced file input when the preview is present',()=>{
 for(const attachmentMode of ['clear','replace']){
  const p=page({fileInput:true,attachmentMode});assert.equal(p.api.start('job-1','Draw',null,null,referenceImage,true).state,'attaching');
  assert.equal(p.fileField.files.length,0);assert.equal(p.api.poll('job-1').state,'generating');assert.equal(p.clicks,1);
 }
});
test('retaining selected files without an actual attachment preview never sends the prompt',()=>{
 const p=page({fileInput:true,attachmentMode:'none'});p.api.start('job-1','Draw',null,null,referenceImage,true);
 assert.equal(p.fileField.files.length,1);assert.equal(p.api.poll('job-1').state,'attaching');p.tick(30_001);
 assert.match(p.api.poll('job-1').error,/未出现可用的参考图预览/);assert.equal(p.clicks,0);
});
test('upload progress is awaited and explicit attachment errors are preserved',()=>{
 const p=page({fileInput:true,attachmentMode:'clear',uploadBusy:true});p.api.start('job-1','Draw',null,null,referenceImage,true);
 assert.equal(p.api.poll('job-1').state,'attaching');p.tick(6000);assert.equal(p.api.poll('job-1').state,'attaching');
 p.setUploadBusy(false);assert.equal(p.api.poll('job-1').state,'generating');assert.equal(p.clicks,1);
 const failed=page({fileInput:true,attachmentMode:'error'});failed.api.start('job-1','Draw',null,null,referenceImage,true);
 assert.match(failed.api.poll('job-1').error,/参考图上传失败.*Image upload failed/);assert.equal(failed.clicks,0);
});
test('removing the preview before send stops submission and cancellation removes only our attachment',()=>{
 const p=page({fileInput:true,attachmentMode:'clear'});p.send.disabled=true;p.api.start('job-1','Draw',null,null,referenceImage,true);assert.equal(p.api.poll('job-1').state,'preparing');
 p.removeReference();p.send.disabled=false;assert.match(p.api.poll('job-1').error,/参考图预览已消失/);assert.equal(p.clicks,0);
 const cancelled=page({fileInput:true,attachmentMode:'clear'});cancelled.api.start('job-1','Draw',null,null,referenceImage,true);cancelled.api.cancel('job-1');
 assert.equal(cancelled.previews.length,0);assert.equal(cancelled.clicks,0);
 const draft=page({fileInput:true});draft.showReference();assert.equal(draft.api.start('job-1','Draw',null,null,referenceImage,true).state,'error');assert.equal(draft.previews.length,1);assert.equal(draft.clicks,0);
});

test('reference images are decoded in memory even when webpage fetch rejects data URLs',async()=>{
 let fetched=false;const p=page({fileInput:true,fetchMedia:async()=>{fetched=true;throw new TypeError('Failed to fetch');}});
 assert.equal(p.api.start('job-1','Draw',null,null,{mimeType:'image/jpeg',dataUrl:'data:image/jpeg;base64,aW1hZ2U='},true).state,'attaching');
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(p.fileField.files[0].type,'image/jpeg');assert.equal(await p.fileField.files[0].text(),'image');
 assert.equal(p.api.poll('job-1').state,'generating');assert.equal(fetched,false);assert.equal(p.clicks,1);
});
test('invalid reference data is reported as an upload failure without sending a prompt',async()=>{
 const p=page({fileInput:true});p.api.start('job-1','Draw',null,null,{mimeType:'image/jpeg',dataUrl:'data:image/jpeg;base64,invalid!'},true);
 await new Promise(resolve=>setImmediate(resolve));
 assert.match(p.api.poll('job-1').error,/参考图上传失败.*本次未发送/);assert.equal(p.clicks,0);
});
test('inline generated images do not use webpage fetch',async()=>{
 let fetched=false;const p=page({fetchMedia:async()=>{fetched=true;throw new TypeError('Failed to fetch');}});
 p.api.start('job-1','Draw',null,null,null,true);p.api.poll('job-1');p.image('data:image/png;base64,aW1hZ2U=');p.finish();p.api.poll('job-1');
 await new Promise(resolve=>setImmediate(resolve));p.tick(2000);
 assert.equal(p.api.poll('job-1').media.mimeType,'image/png');assert.equal(fetched,false);
});
test('remote fetch failures identify the media download step and retain the original result',async()=>{
 const p=page({fetchMedia:async()=>{throw new TypeError('Failed to fetch');}});
 p.api.start('job-1','Draw',null,null,null,true);p.api.poll('job-1');p.image();p.finish();p.api.poll('job-1');
 await new Promise(resolve=>setImmediate(resolve));p.tick(2000);
 assert.match(p.api.poll('job-1').error,/媒体读取失败.*下载失败（muse.ai）.*原结果仍保留/);assert.equal(p.clicks,1);
});

test('image generation waits for a late image after completed text and never resubmits',async()=>{
 const p=page();p.api.start('job-1','Draw an invitation',null,null,null,true);p.api.poll('job-1');
 p.reply('Your image is being prepared.');p.finish();p.api.poll('job-1');p.tick(30_000);
 assert.equal(p.api.poll('job-1').state,'generating');assert.equal(p.clicks,1);
 p.image();p.api.poll('job-1');await new Promise(resolve=>setImmediate(resolve));p.tick(2000);
 const output=p.api.poll('job-1');assert.equal(output.state,'done');assert.equal(output.media.mimeType,'image/png');assert.equal(output.media.dataUrl,'data:image/png;base64,aW1hZ2U=');assert.equal(p.clicks,1);
});
test('a failed image download is reported even when Muse also returned prose',async()=>{
 const p=page({fetchMedia:async()=>({ok:false})});p.api.start('job-1','Draw',null,null,null,true);p.api.poll('job-1');
 p.reply('Here is the image.');p.image();p.finish();p.api.poll('job-1');await new Promise(resolve=>setImmediate(resolve));p.tick(2000);
 const output=p.api.poll('job-1');assert.equal(output.state,'error');assert.match(output.error,/媒体读取失败.*无法读取 Muse 媒体文件/);assert.equal(output.sent,true);assert.equal(p.clicks,1);
});
test('waiting for media times out without returning prose or capturing the user reference',()=>{
 const p=page();p.api.start('job-1','Draw',null,null,null,true);p.api.poll('job-1');p.image('https://muse.ai/reference.png',false);
 p.reply('I have only written a description.');p.finish();p.api.poll('job-1');p.tick(180_001);
 const output=p.api.poll('job-1');assert.equal(output.state,'error');assert.match(output.error,/等待图片或视频超时/);assert.equal(output.media,undefined);assert.equal(p.clicks,1);
});
test('downloadable image attachments are collected within the current assistant response',async()=>{
 const p=page();p.api.start('job-1','Draw',null,null,null,true);p.api.poll('job-1');p.attachment('https://muse.ai/generated.png');p.finish();p.api.poll('job-1');
 await new Promise(resolve=>setImmediate(resolve));p.tick(2000);assert.equal(p.api.poll('job-1').media.mimeType,'image/png');assert.equal(p.clicks,1);
});
test('downloadable references cannot make the collector fetch an untrusted media host',async()=>{
 let fetched=false;const p=page({fetchMedia:async()=>{fetched=true;throw Error('Must not fetch');}});
 p.api.start('job-1','Draw',null,null,null,true);p.api.poll('job-1');p.attachment('https://untrusted.example/generated.png');p.finish();p.api.poll('job-1');
 await new Promise(resolve=>setImmediate(resolve));p.tick(2000);
 assert.match(p.api.poll('job-1').error,/媒体来源不受支持（untrusted.example）/);assert.equal(fetched,false);assert.equal(p.clicks,1);
});

test('session restoration waits for hydration before reporting a login requirement',()=>{
 const p=page();p.setInputVisible(false);p.setNotice('Log in or create an account');p.setHydration('hydrating');
 assert.equal(p.api.inspect().state,'loading');assert.equal(p.clicks,0);
 p.setHydration('hydrated');assert.equal(p.api.inspect().state,'login');
 p.setInputVisible(true);p.setNotice('');assert.equal(p.api.inspect().state,'ready');
});
test('web driver refuses an existing thread, wrong request ID and foreign origins before filling anything',()=>{
 for(const setup of [p=>p.old(),p=>p.location.search='?wapRequest=other',p=>p.location.origin='https://evil.test']){
  const p=page();setup(p);assert.notEqual(p.api.start('job-1','private context').state,'preparing');assert.equal(p.field.value,'');assert.equal(p.clicks,0);
 }
});
test('a fresh Muse request clicks send once and only returns stable completed assistant prose',()=>{
 const p=page();assert.equal(p.api.start('job-1','Customer: bonjour').state,'preparing');
 assert.equal(p.api.poll('job-1').state,'generating');assert.equal(p.clicks,1);
 p.reply('[{"text":"Bonjour !"}]');assert.equal(p.api.poll('job-1').state,'generating');p.tick(3000);
 assert.equal(p.api.poll('job-1').state,'generating');p.finish();
 assert.equal(p.api.poll('job-1').state,'done');assert.equal(p.api.poll('job-1').text,'[{"text":"Bonjour !"}]');assert.equal(p.clicks,1);
});
test('quota words in conversation data are not mistaken for account notices',()=>{
 const p=page();p.api.start('job-1','Customer asks what usage limit means');p.api.poll('job-1');
 assert.equal(p.api.inspect().state,'busy');p.setNotice('out of credits');assert.equal(p.api.poll('job-1').state,'error');assert.equal(p.clicks,1);
});
test('quota labels, available balances and upgrade explanations do not block a ready composer',()=>{
 for(const notice of [
  'Usage limit\nFree plan\n0% used\nWeekly limit resets November 14\nAdditional credits\n0% used (1 billion tokens remaining)',
  '使用情况\n免费版\n已使用 0%\n每周限额将在 11月14日重置\n额外的使用额度\n已使用 0%（剩余 10 亿个词元）',
  'Token limit: 65000\nIf you reach your usage limit, you can upgrade.\n额度不足时可以升级。',
  'You have not reached your weekly limit.',
 ]){
  const p=page();p.setNotice(notice);assert.equal(p.api.inspect().state,'ready',notice);
  assert.equal(p.api.start('job-1','Hello').state,'preparing');assert.equal(p.api.poll('job-1').state,'generating');assert.equal(p.clicks,1);
 }
});
test('explicit exhausted-quota messages still block submission',()=>{
 for(const notice of ['out of credits','You’ve reached your weekly limit.','You have hit your usage limit.','Usage limit reached.','Insufficient credits.','已用完使用额度','额度不足，请升级。','您的本周使用额度已用完。','已达到每周使用上限。']){
  const p=page();p.setNotice(notice);assert.equal(p.api.inspect().state,'quota',notice);
  assert.equal(p.api.start('job-1','Hello').state,'quota');assert.equal(p.clicks,0);
 }
});
test('disabled sending, cancellation and manually switched conversations never produce a reply',()=>{
 const disabled=page();disabled.send.disabled=true;disabled.api.start('job-1','Hello');disabled.tick(6000);assert.equal(disabled.api.poll('job-1').state,'error');assert.equal(disabled.clicks,0);
 const cancelled=page();cancelled.api.start('job-1','Hello');cancelled.api.cancel('job-1');assert.equal(cancelled.api.poll('job-1').state,'error');assert.equal(cancelled.clicks,0);
 const switched=page();switched.api.start('job-1','Correct contact context');switched.api.poll('job-1');switched.replaceThread();switched.finish();assert.equal(switched.api.poll('job-1').state,'generating');switched.tick(16_000);assert.equal(switched.api.poll('job-1').state,'error');
});
test('the send action supports the page language without treating assistant follow-ups as send buttons',()=>{
 for(const label of ['Send message','发送消息','Envoyer']){
  const p=page();p.send.getAttribute=key=>key==='aria-label'?label:null;
  p.api.start('job-1','Hello');assert.equal(p.api.poll('job-1').state,'generating');assert.equal(p.clicks,1);
 }
});
test('a customer resumes its verified thread after reload and never receives a previous answer',()=>{
 const p=page(),owner='a'.repeat(64);
 assert.equal(p.api.start('job-1','Old rules',null,owner).state,'preparing');
 assert.equal(p.api.poll('job-1').path,'/thread/new-id');
 p.reply('Old draft');p.finish();p.api.poll('job-1');p.tick(2000);assert.equal(p.api.poll('job-1').state,'done');
 p.reload();p.location.search='';
 assert.equal(p.api.inspect('job-2','/thread/new-id',owner).matched,true);
 assert.equal(p.api.start('job-2','New rules and latest WhatsApp history','/thread/new-id',owner).state,'preparing');
 assert.match(p.field.value,/New rules/);assert.match(p.field.value,/WAP request ID: job-2/);
 p.api.poll('job-2');p.finish();p.tick(3000);
 const waiting=p.api.poll('job-2');assert.equal(waiting.state,'generating');assert.equal(waiting.text,undefined);
 p.reply('New draft');p.api.poll('job-2');p.tick(2000);
 assert.equal(p.api.poll('job-2').state,'done');assert.equal(p.api.poll('job-2').text,'New draft');assert.equal(p.clicks,2);
});
test('saved threads require both the exact path and the customer marker before any new input',()=>{
 const p=page(),owner='a'.repeat(64);
 p.api.start('job-1','Hello',null,owner);p.api.poll('job-1');p.api.cancel('job-1');p.reload();
 for(const [path,key] of [['/thread/new-id','b'.repeat(64)],['/thread/other',owner],['/thread/new-id',null],['https://evil.test/thread/new-id',owner]]){
  assert.equal(p.api.inspect('job-2',path,key).matched,false);
  assert.equal(p.api.start('job-2','Another customer',path,key).state,'error');assert.equal(p.field.value,'');assert.equal(p.clicks,1);
 }
 p.replaceThread();assert.equal(p.api.start('job-2','Hello','/thread/new-id',owner).state,'error');
});
test('old text drafts are cleared before preparing and navigating away from a bound thread stops the request',()=>{
 const draft=page();draft.field.value='Manual draft';assert.equal(draft.api.start('job-1','Hello').state,'preparing');assert.match(draft.field.value,/Hello/);assert.doesNotMatch(draft.field.value,/Manual draft/);assert.equal(draft.clicks,0);
 const p=page();p.api.start('job-1','Hello',null,'a'.repeat(64));p.api.poll('job-1');p.location.pathname='/thread/another';
 assert.equal(p.api.poll('job-1').state,'error');assert.equal(p.clicks,1);
});
test('handoff context can accompany the full original prompt without truncating multilingual instructions',()=>{
 const p=page(),profile='完整提示词：'+ '新'.repeat(64_900),summary='前文摘要：'+'忆'.repeat(6000);
 assert.equal(p.api.start('job-1',summary+'\n'+profile).state,'preparing');
 assert.ok(p.field.value.endsWith(profile));assert.match(p.field.value,/前文摘要/);assert.equal(p.api.poll('job-1').state,'generating');
 const tooLong=page();assert.equal(tooLong.api.start('job-1','x'.repeat(110_001)).state,'error');assert.equal(tooLong.clicks,0);
});

const root=fileURLToPath(new URL('../',import.meta.url));
const bundled=await build({stdin:{contents:`export {generateSuggestions} from './src/lib/aiSuggest.ts';export {extractChatSheetFields} from './src/lib/aiCustomerCard.ts';export {defaultSettings} from './src/store/settingsDefaults.ts';`,resolveDir:root},bundle:true,write:false,format:'esm',platform:'node',alias:{'@':root+'src'},plugins:[{name:'muse-boundary',setup(b){
 b.onResolve({filter:/museWeb\.ts$/},()=>({path:'muse',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const generateMuseWeb=(...args)=>globalThis.museTest(...args);'}));
}}]});
const ai=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
test('Muse reuses configured prompts, context, JSON parsing and output constraints without an API key',async()=>{
 let prompt,context;globalThis.museTest=async(value,signal,key,current)=>{prompt=value;context=current;return '[{"text":"Bonjour !","tone":"warm"}]';};
 const settings={...ai.defaultSettings,aiProvider:'muse',aiSystemPrompt:'Reply in French. Do not promise anything.'};
 const result=await ai.generateSuggestions({id:'test',name:'Alice',phone:'+12025550101'},[{id:'m1',chatId:'test',direction:'in',body:'Salut',sentAt:'2026-11-07T12:00:00Z'}],settings,{count:1});
 assert.equal(result.source,'muse');assert.equal(result.fallback,false);assert.equal(result.suggestions[0].text,'Bonjour !');
 assert.match(context.profile,/Reply in French/);assert.doesNotMatch(prompt,/Reply in French/);assert.match(prompt,/Salut/);assert.match(prompt,/JSON array of exactly 1/);assert.match(prompt,/Do not use tools/);
 globalThis.museTest=async()=>{throw Error('Please sign in');};
 const failed=await ai.generateSuggestions({id:'test'},[],settings,{auto:true});assert.equal(failed.fallback,true);assert.deepEqual(failed.suggestions,[]);assert.match(failed.error,/sign in/);
});

test('Muse manual replies, automatic replies and outreach omit contact cards and isolate the current thread',async()=>{
 const calls=[];globalThis.museTest=async(prompt,_signal,key,context)=>{calls.push({prompt,key,context});return '[{"text":"Bonjour"}]';};
 const settings={...ai.defaultSettings,aiProvider:'muse',aiSystemPrompt:'Use French and offer tomorrow at 17:00. My name is Alexandre.',waAccounts:[{id:'a',label:'1: Alexandre'}]};
 const contact={id:'c',accountId:'a',name:'Alice',phone:'+33612345678',tags:['PRIVATE TAG'],notes:'PRIVATE NOTE',aiSummary:'PRIVATE SUMMARY',company:'PRIVATE COMPANY'};
 const first={id:'m1',chatId:'chat',accountId:'a',direction:'in',sentAt:'2026-11-12T10:00:00Z',body:'Alice +33612345678',mediaType:'audio',transcript:'Alice : rendez-vous demain à 17:00',quoted:{id:'q1',body:'Alice, téléphone +33612345678',senderName:'Bob'}};
 const history=[first,{...first,id:'cross-chat',chatId:'elsewhere',body:'OTHER CHAT SECRET',transcript:undefined},
  {...first,id:'cross-account',accountId:'b',body:'OTHER ACCOUNT SECRET',transcript:undefined}];
 for(const opts of [{count:1},{auto:true,replyTo:first},{auto:true,outreach:'Invite Alice to tomorrow at 17:00'}])await ai.generateSuggestions(contact,history,settings,{...opts,accountId:'a',chatId:'chat'});
 assert.equal(calls.length,3);
 for(const {prompt,context} of calls){
  assert.doesNotMatch(prompt+context.profile,/Alice|Alexandre|Bob|33612345678|PRIVATE|OTHER CHAT|OTHER ACCOUNT|Contact:|Phone:|Notes:|AI summary:/);
  assert.match(prompt,/rendez-vous demain à 17:00/);assert.match(context.profile,/Use French and offer tomorrow at 17:00/);
  assert.deepEqual(context.history.map(item=>item.id),['m1']);
  assert.equal(prompt,context.prefix+context.history.map(item=>item.text).join('\n')+context.suffix);
 }
 const before=calls.length;
 const failed=await ai.generateSuggestions(contact,history,settings,{chatId:'chat',accountId:'a',replyTo:history[1]});
 assert.equal(failed.fallback,true);assert.equal(calls.length,before);
});

test('Muse spreadsheet extraction omits identity metadata, shared cards and unrelated conversations',async()=>{
 let sent;globalThis.museTest=async prompt=>{sent=prompt;return '{"need":"tomorrow"}';};
 const settings={...ai.defaultSettings,aiProvider:'muse'},contact={id:'c',name:'Alice',phone:'+33612345678',company:'SECRET COMPANY'};
 const first={id:'m',chatId:'c',direction:'in',body:'Alice needs tomorrow at 17:00',sentAt:'2026-11-12T12:00:00Z'};
 const messages=[first,{...first,id:'other',chatId:'other',body:'FOREIGN CHAT DATA'},
  {...first,id:'card',body:'UNKNOWN CARD PERSON',contactCard:{displayName:'UNKNOWN CARD PERSON'}}];
 const result=await ai.extractChatSheetFields(contact,messages,settings,[{id:'need',label:'Need'}],'');
 assert.deepEqual(result,{need:'tomorrow'});assert.match(sent,/tomorrow at 17:00/);
 assert.doesNotMatch(sent,/Alice|33612345678|SECRET COMPANY|FOREIGN CHAT DATA|UNKNOWN CARD PERSON/);
});
test('manual replies, auto replies and outreach share a stable customer key while accounts and customers stay separate',async()=>{
 const calls=[];globalThis.museTest=async(prompt,signal,key,context,priority)=>{calls.push({prompt,key,context,priority});return '[{"text":"Bonjour"}]';};
 const settings={...ai.defaultSettings,aiProvider:'muse',aiSystemPrompt:'Old profile'},contact={id:'customer-a',accountId:'account-1'},history=[{id:'m1',chatId:'chat-a',direction:'in',body:'Bonjour',sentAt:'2026-11-07T12:00:00Z'}];
 await ai.generateSuggestions(contact,history,settings,{count:1});
 await ai.generateSuggestions(contact,history,{...settings,aiSystemPrompt:'Updated profile'},{auto:true,replyTo:history[0]});
 await ai.generateSuggestions(contact,history,settings,{auto:true,outreach:'Follow up tomorrow',chatId:'chat-a'});
 await ai.generateSuggestions({...contact,id:'customer-b'},history,settings,{count:1});
 await ai.generateSuggestions(contact,history,settings,{accountId:'account-2',count:1});
 assert.ok(calls[0].key);assert.equal(calls[1].key,calls[0].key);assert.equal(calls[2].key,calls[0].key);
 assert.notEqual(calls[3].key,calls[0].key);assert.notEqual(calls[4].key,calls[0].key);
 assert.match(calls[1].context.profile,/Updated profile/);assert.doesNotMatch(calls[1].context.profile,/Old profile/);
 assert.deepEqual(calls.slice(0,3).map(call=>call.priority),[2,1,0]);
 assert.match(calls[1].prompt,/latest reply instructions replace/);assert.match(calls[1].prompt,/drafts, not evidence/);
});
test('Muse supplies bounded structured history with exactly the same full context and excludes unsent drafts',async()=>{
 let captured;globalThis.museTest=async(prompt,signal,key,context)=>{captured={prompt,key,context};return '[{"text":"Bonjour"}]';};
 const history=Array.from({length:45},(_,i)=>({id:'m'+i,chatId:'chat-a',direction:'in',body:'Actual message '+i,sentAt:new Date(Date.UTC(2026,10,7,12,i)).toISOString()}));
 history.push({id:'pending',chatId:'chat-a',direction:'out',body:'Unsent draft',deliveryStatus:'pending',sentAt:'2026-11-07T13:00:00Z'});
 const result=await ai.generateSuggestions({id:'customer-a'},history,{...ai.defaultSettings,aiProvider:'muse',aiSystemPrompt:'Complete profile stays intact.'},{count:1});
 assert.equal(result.fallback,false);const {context,prompt}=captured;
 assert.equal(context.history.length,40);assert.equal(context.history[0].id,'m5');assert.equal(context.history.at(-1).id,'m44');
 assert.equal(context.prefix+context.history.map(item=>item.text).join('\n')+context.suffix,prompt);
 assert.match(context.profile,/Complete profile stays intact/);assert.doesNotMatch(context.prefix,/Complete profile stays intact/);assert.match(context.suffix,/Runtime clock/);assert.doesNotMatch(prompt,/Unsent draft/);
});

const clientBuild=await build({stdin:{contents:`export * from './src/lib/museWeb.ts';export {setMusePrivacyIdentityProvider} from './src/lib/museChatPrivacy.ts';export {getAiUsageSnapshot} from './src/lib/aiUsage.ts';`,resolveDir:root},bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'native-boundary',setup(b){
 b.onResolve({filter:/bridge\.ts$/},()=>({path:'bridge',namespace:'native-mock'}));b.onResolve({filter:/^@tauri-apps\/api\/core$/},()=>({path:'tauri',namespace:'native-mock'}));
 b.onLoad({filter:/.*/,namespace:'native-mock'},args=>({contents:args.path==='bridge'?'export const isTauri=()=>true;':'export const invoke=(...args)=>globalThis.museNative(...args);'}));
}}]});
const client=await import('data:text/javascript;base64,'+Buffer.from(clientBuild.outputFiles[0].text).toString('base64'));
client.setMusePrivacyIdentityProvider(()=>{
 if(globalThis.musePrivacyFailure)throw Error('Privacy state unavailable');
 const state=globalThis.musePrivacyState||{contacts:[],settings:{waAccounts:[]}};
 return [...state.contacts,...state.settings.waAccounts];
});

test('native Muse submission redacts all locally known contacts and starts a new privacy-scoped thread',async()=>{
 let submitted;globalThis.museNative=async(_cmd,args)=>{submitted=args;return{text:'Bonjour'};};
 globalThis.musePrivacyState={contacts:[{name:'Bob Private',phone:'+243812345678'},{name:'Carol Private',phone:'+33600000000'}],settings:{waAccounts:[{userName:'Alexandre'}]}};
 try{
  const context={profile:'Alexandre uses French. Bob Private is only an example.',prefix:'Chat:\n',history:[{id:'local-id',text:'Bob Private: send +243812345678 to Carol Private'}],suffix:'\nAt 17:00'};
  await client.generateMuseWeb(context.prefix+context.history[0].text+context.suffix,undefined,'old-thread',context);
  assert.doesNotMatch(submitted.prompt+submitted.context.profile,/Bob Private|Carol Private|243812345678|Alexandre/);
  assert.equal(submitted.prompt,submitted.context.prefix+submitted.context.history.map(item=>item.text).join('\n')+submitted.context.suffix);
  assert.equal(submitted.conversationKey,JSON.stringify(['private-chat-v1','old-thread']));
  await client.generateMuseWeb('Bob Private +243812345678',undefined,JSON.stringify(['sheet-extract','a','c']));
  assert.doesNotMatch(submitted.prompt,/Bob Private|243812345678/);assert.match(submitted.conversationKey,/private-chat-v1/);
 }finally{delete globalThis.musePrivacyState;}
});

test('a missing local privacy context fails closed before sending anything to Muse',async()=>{
 let calls=0;globalThis.museNative=async()=>{calls++;return{text:'Unexpected'};};globalThis.musePrivacyFailure=true;
 try{await assert.rejects(client.generateMuseWeb('text',undefined,'key',{profile:'',prefix:'',history:[{id:'m',text:'text'}],suffix:''}),/Privacy state unavailable/);assert.equal(calls,0);}
 finally{delete globalThis.musePrivacyFailure;}
});
test('retrieving existing media invokes only the collect command',async()=>{
 const calls=[];globalThis.museNative=async(cmd)=>{calls.push(cmd);return{mimeType:'image/png',dataUrl:'data:image/png;base64,aW1hZ2U='};};
 assert.equal((await client.collectMuseWebMedia()).data,'aW1hZ2U=');assert.deepEqual(calls,['muse_web_collect_media']);
});
test('media requests refuse an old desktop backend before submitting another generation',async()=>{
 const calls=[];globalThis.museNative=async(cmd,args)=>{calls.push([cmd,args]);return {ready:true,state:'ready',message:'Connected'};};
 await assert.rejects(client.generateMuseWebOutput('Draw',undefined,undefined,undefined,undefined,true),/旧版 Muse.*未提交生图/);
 assert.deepEqual(calls.map(([cmd])=>cmd),['muse_web_status']);
});
test('media requests pass the explicit wait flag and preserve the returned media',async()=>{
 const calls=[];globalThis.museNative=async(cmd,args)=>{calls.push([cmd,args]);return cmd==='muse_web_status'?{ready:true,mediaProtocol:7,parallelMedia:true}:{text:'Here it is',media:{mimeType:'image/png',dataUrl:'data:image/png;base64,aW1hZ2U='},error:null,summaryRequests:0};};
 const result=await client.generateMuseWebOutput('Draw',undefined,undefined,undefined,undefined,true);
 assert.equal(result.media.data,'aW1hZ2U=');assert.equal(calls[0][1].media,true);assert.equal(calls[1][0],'muse_web_generate');assert.equal(calls[1][1].expectMedia,true);
});
test('the native adapter passes both reference images without collapsing the subject and style',async()=>{
 let submitted;globalThis.museNative=async(cmd,args)=>{if(cmd==='muse_web_status')return{ready:true,mediaProtocol:7,parallelMedia:true};submitted=args;return{text:null,media:{mimeType:'image/png',dataUrl:'data:image/png;base64,aW1hZ2U='},error:null,summaryRequests:0};};
 const subject={mimeType:'image/jpeg',dataUrl:'data:image/jpeg;base64,c3ViamVjdA=='},style={mimeType:'image/jpeg',dataUrl:'data:image/jpeg;base64,c3R5bGU='};
 await client.generateMuseWebOutput('Compose two images',undefined,undefined,undefined,[subject,style],true);
 assert.deepEqual(submitted.referenceImages,[subject,style]);assert.equal(submitted.referenceImage,null);
});

test('the native adapter can finish a text reply while a media generation is still running',async()=>{
 let finishImage;const imageReady=new Promise(resolve=>{finishImage=resolve;});const calls=[];
 globalThis.museNative=async(cmd,args)=>{
  calls.push([cmd,args]);if(cmd==='muse_web_status')return{ready:true,mediaProtocol:7,parallelMedia:true};
  if(args.expectMedia){await imageReady;return{media:{mimeType:'image/png',dataUrl:'data:image/png;base64,aW1hZ2U='}};}
  return{text:'Text finished'};
 };
 const image=client.generateMuseWebOutput('Draw',undefined,undefined,undefined,undefined,true);
 await new Promise(resolve=>setImmediate(resolve));
 try{assert.equal(await client.generateMuseWeb('Reply'),'Text finished');assert.equal(calls.filter(([cmd])=>cmd==='muse_web_generate').length,2);}
 finally{finishImage();await image;}
});
test('IPC transport failures identify the desktop connection instead of reporting a Muse download',async()=>{
 globalThis.museNative=async()=>{throw new TypeError('Failed to fetch');};
 await assert.rejects(client.generateMuseWebOutput('Draw',undefined,undefined,undefined,undefined,true),/Muse 桌面通信中断.*避免重复生成/);
});
test('the native adapter serializes customers and aborts queued requests without submitting them',async()=>{
 const calls=[];let resolve;
 globalThis.museNative=async(cmd,args)=>{calls.push([cmd,args]);if(cmd==='muse_web_generate')return new Promise(r=>resolve=r);};
 const context={prefix:'',history:[{id:'m1',text:'first customer'}],suffix:''};
 const first=client.generateMuseWeb('first customer',undefined,'customer-a',context);await new Promise(r=>setImmediate(r));
 const controller=new AbortController();const second=client.generateMuseWeb('second customer',controller.signal);controller.abort();
 assert.equal(calls.filter(([cmd])=>cmd==='muse_web_generate').length,1);resolve('first reply');assert.equal(await first,'first reply');await assert.rejects(second,/abort/i);
 assert.equal(calls[0][1].conversationKey,JSON.stringify(['private-chat-v1','customer-a']));
 assert.deepEqual(calls[0][1].context,{...context,profile:''});
 assert.equal(calls.filter(([cmd])=>cmd==='muse_web_generate').length,1);
});
test('cancelling an active adapter request is scoped and a late reply is never returned',async()=>{
 const calls=[];let resolve;
 globalThis.museNative=async(cmd,args)=>{calls.push([cmd,args]);if(cmd==='muse_web_generate')return new Promise(r=>resolve=r);};
 const controller=new AbortController();const result=client.generateMuseWeb('customer',controller.signal);await new Promise(r=>setImmediate(r));controller.abort();await new Promise(r=>setImmediate(r));
 assert.equal(calls[1][0],'muse_web_cancel');assert.equal(calls[1][1].requestId,calls[0][1].requestId);resolve('late reply');await assert.rejects(result,/abort/i);
});
test('handoff generations are counted separately with unknown tokens, including failed summaries',async()=>{
 globalThis.museNative=async()=>({text:'New reply',error:null,summaryRequests:1,summaryFailed:false});
 assert.equal(await client.generateMuseWeb('Reply after handoff',undefined,'customer'),'New reply');
 let row=client.getAiUsageSnapshot().buckets.find(row=>row.feature==='context');
 assert.equal(row.requests,1);assert.equal(row.unknown,1);assert.equal(row.total,0);assert.equal(row.failed,0);assert.equal(row.reportedRequests,0);
 globalThis.museNative=async()=>({text:null,error:'Invalid summary; old thread preserved',summaryRequests:1,summaryFailed:true});
 await assert.rejects(client.generateMuseWeb('Try handoff',undefined,'customer'),/old thread preserved/);
 row=client.getAiUsageSnapshot().buckets.find(row=>row.feature==='context');assert.equal(row.requests,2);assert.equal(row.failed,1);assert.equal(row.unknown,2);
 globalThis.museNative=async()=>({text:'Ordinary reply',error:null,summaryRequests:0,summaryFailed:false});
 assert.equal(await client.generateMuseWeb('No handoff'),'Ordinary reply');assert.equal(client.getAiUsageSnapshot().buckets.find(row=>row.feature==='context').requests,2);
});
test('account switching refuses an active generation and requires a verified new login before reuse',async()=>{
 await new Promise(resolve=>setImmediate(resolve));
 let finish;globalThis.museNative=async cmd=>cmd==='muse_web_generate'?await new Promise(resolve=>{finish=resolve;}):undefined;
 const generation=client.generateMuseWeb('Active reply');await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(client.switchMuseWebAccount(),/等待完成后切换账号/);
 finish('Done');await generation;await new Promise(resolve=>setImmediate(resolve));
 let ready=false;const commands=[];
 globalThis.museNative=async cmd=>{commands.push(cmd);return cmd==='muse_web_status'?{ready,state:ready?'ready':'login',message:'Sign in'}:'New account reply';};
 await client.switchMuseWebAccount();assert.deepEqual(commands,['muse_web_switch_account']);
 await assert.rejects(client.generateMuseWeb('Must not send'),/登录新的 Muse 账号/);
 await client.museWebStatus();await assert.rejects(client.generateMuseWeb('Still signed out'),/登录新的 Muse 账号/);
 ready=true;await client.museWebStatus();assert.equal(await client.generateMuseWeb('New login'),'New account reply');
});
test('no generation can enter the queue while account switching is in progress',async()=>{
 await new Promise(resolve=>setImmediate(resolve));
 let finish;globalThis.museNative=async cmd=>cmd==='muse_web_switch_account'?await new Promise(resolve=>{finish=resolve;}):{ready:true,state:'ready'};
 const switching=client.switchMuseWebAccount();await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(client.generateMuseWeb('Do not submit'),/登录新的 Muse 账号/);
 finish();await switching;await client.museWebStatus();
});
