import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const mocks={
  react:'export const useState=v=>globalThis.mediaHooks.state(v);export const useRef=v=>globalThis.mediaHooks.ref(v);export const useCallback=(f,d)=>globalThis.mediaHooks.callback(f,d);export const useEffect=(f,d)=>globalThis.mediaHooks.effect(f,d);',
  'react/jsx-runtime':'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";',
  'lucide-react':'export const FileImage="icon",FileAudio="icon",FileVideo="icon",FileText="icon",Plus="icon",X="icon";',
  '@/lib/utils':'export const cn=(...args)=>args.filter(Boolean).join(" ");',
  '@/components/ui/primitives':'export const Button="button";',
  '@/i18n':'export const useI18n=()=>({t:k=>k});',
  '../chat/PlanVoiceRecorder':'export const PlanVoiceRecorder="recorder";',
};
const output=await build({entryPoints:[fileURLToPath(new URL('../src/components/views/BroadcastMediaPicker.tsx',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',plugins:[{name:'media-boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {BroadcastMediaPicker}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t?.props?[t,...nodes(t.props.children)]:[];
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function harness(initial={}){
  const oldReader=globalThis.FileReader,slots=[],updates=[],busy=[],effects=[];let cursor=0,tree,reads=0;
  globalThis.FileReader=class{readAsDataURL(){reads++;this.result='data:image/png;base64,aW1hZ2U=';this.onload();}};
  const props={media:initial.media||[],dataUrls:initial.dataUrls||{},mediaMode:'single',onChange:(media,mode,dataUrls)=>updates.push({media,mode,dataUrls}),onBusyChange:value=>busy.push(value)};
  const equal=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const h={updates,busy,get reads(){return reads;},render(){cursor=0;globalThis.mediaHooks={
    state(value){const i=cursor++;slots[i]??={value:typeof value==='function'?value():value};return[slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value;}];},
    ref(value){return slots[cursor++]??={current:value};},
    callback(fn,deps){const i=cursor++;if(!equal(slots[i]?.deps,deps))slots[i]={fn,deps};return slots[i].fn;},
    effect(fn,deps){const i=cursor++;if(!equal(slots[i]?.deps,deps)){const old=slots[i];slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}},
  };tree=BroadcastMediaPicker(props);effects.splice(0).forEach(f=>f());return nodes(tree);},
    recorder(){return nodes(tree).find(n=>n.type==='recorder').props;},
    async add(file){nodes(tree).find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[file]}});await settle();h.render();},
    close(){slots.forEach(s=>s?.cleanup?.());globalThis.FileReader=oldReader;delete globalThis.mediaHooks;}
  };h.render();return h;
}
const voice={kind:'audio',dataUrl:'data:audio/ogg;base64,T2dnUw==',mimeType:'audio/ogg',size:500,fileName:'recording.ogg'};

test('the marketing picker exposes direct recording, stages a voice note, and permits listening before send',()=>{
  const h=harness();try{
    const recorder=h.recorder();recorder.onBusyChange(true);let tree=h.render();
    assert.equal(tree.find(n=>n.type==='button').props.disabled,true);assert.deepEqual(h.busy,[true]);
    assert.equal(h.recorder().onBusyChange,recorder.onBusyChange,'rerenders must not cancel the recorder');
    h.recorder().onRecorded(voice);h.recorder().onBusyChange(false);tree=h.render();
    assert.equal(h.updates.length,1);const saved=h.updates[0];
    assert.equal(saved.media[0].voiceNote,true);assert.equal(saved.media[0].mime,'audio/ogg');assert.equal(saved.dataUrls[saved.media[0].id],voice.dataUrl);
    assert.equal(tree.find(n=>n.type==='audio').props.controls,true);assert.equal(tree.find(n=>n.type==='audio').props.src,voice.dataUrl);
    tree.find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:false}});h.render();
    assert.equal(h.updates.at(-1).media[0].voiceNote,undefined,'file mode remains available');
  }finally{h.close();}
});

test('cancelling a capture preserves uploaded files, while a finished note adds to the same media pool',async()=>{
  const h=harness();try{
    await h.add({size:5,type:'image/png',name:'existing.png'});const image=h.updates.at(-1).media[0];
    h.recorder().onBusyChange(true);h.render();h.recorder().onBusyChange(false);h.render();
    assert.equal(h.updates.length,1);assert.equal(h.updates.at(-1).media[0].id,image.id);
    h.recorder().onRecorded(voice);h.render();assert.equal(h.updates.at(-1).media.length,2);
    assert.equal(h.updates.at(-1).media[0].id,image.id);
    const remove=h.render().filter(n=>n.type==='button'&&n.props.title==='broadcast.removeMedia').at(-1);remove.props.onClick();h.render();
    assert.equal(h.updates.at(-1).media.length,1);assert.equal(h.updates.at(-1).media[0].id,image.id);
  }finally{h.close();}
});

test('oversized imports are rejected before reading and release the setup busy state',async()=>{
  const h=harness();try{
    await h.add({size:15*1024*1024,type:'audio/ogg',name:'large.ogg'});
    assert.equal(h.reads,0);assert.equal(h.updates.length,0);assert.deepEqual(h.busy,[true,false]);
    assert.ok(h.render().some(n=>n.props.role==='alert'));assert.equal(h.recorder().disabled,false);
  }finally{h.close();}
});

test('returning to setup keeps the previous recording visible and preserves it when recording another',()=>{
  const h=harness({media:[{id:'previous',kind:'audio',mime:'audio/ogg',voiceNote:true}],dataUrls:{previous:voice.dataUrl}});
  try {
    assert.equal(h.render().find(n=>n.type==='audio').props.src,voice.dataUrl);
    h.recorder().onRecorded(voice);h.render();
    assert.equal(h.updates.at(-1).media.length,2);assert.equal(h.updates.at(-1).media[0].id,'previous');
    assert.equal(h.updates.at(-1).dataUrls.previous,voice.dataUrl);
  }finally{h.close();}
});
