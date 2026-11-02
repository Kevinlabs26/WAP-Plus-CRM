import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const mocks={
  react:'export const useState=i=>globalThis.recorderHooks.state(i);export const useRef=i=>globalThis.recorderHooks.ref(i);export const useEffect=(f,d)=>globalThis.recorderHooks.effect(f,d);',
  'react/jsx-runtime':'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;',
  'lucide-react':'export const Mic="mic",Square="square",X="x";',
  '@/components/ui/primitives':'export const Button="button";',
  '@/i18n':'export const useI18n=()=>({t:k=>k});',
  '@/lib/voiceRecord':'export const canRecordVoice=()=>globalThis.captureAvailable;export const startVoiceRecording=()=>globalThis.captureStart();',
};
const built=await build({entryPoints:[fileURLToPath(new URL('../src/components/chat/PlanVoiceRecorder.tsx',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',plugins:[{name:'capture-boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {PlanVoiceRecorder}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree?.props?[tree,...nodes(tree.props.children)]:[];
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const result={dataUrl:'data:audio/webm;codecs=opus;base64,'+Buffer.alloc(500).toString('base64'),mimeType:'audio/webm;codecs=opus',durationSec:4,byteLength:500};
function harness(options={}) {
  const oldWindow=globalThis.window,slots=[],timers=new Set(),busy=[],recorded=[];
  let cursor=0,effects=[],tree,cancelled=0,stopped=0,starts=0;
  const session={durationSec:()=>options.seconds||4,cancel(){cancelled++;},stop(){stopped++;return options.stop?options.stop():Promise.resolve(options.result||result);}};
  globalThis.window={setInterval(fn){timers.add(fn);return fn;},clearInterval(fn){timers.delete(fn);}};
  globalThis.captureAvailable=options.available!==false;
  globalThis.captureStart=()=>{starts++;return options.start?options.start(session):Promise.resolve(session);};
  const props={disabled:!!options.disabled,onBusyChange:value=>busy.push(value),onRecorded:value=>recorded.push(value)};
  const h={timers,busy,recorded,session,get cancelled(){return cancelled;},get stopped(){return stopped;},get starts(){return starts;},
    render(){cursor=0;effects=[];globalThis.recorderHooks={
      state(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},
      ref(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},
      effect(work,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>v!==old.deps[j]))effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:work()};});},
    };tree=PlanVoiceRecorder(props);effects.forEach(work=>work());return nodes(tree);},
    button(label){return nodes(tree).find(n=>n.type==='button'&&(n.props['aria-label']===label||n.props.children===label||Array.isArray(n.props.children)&&n.props.children.includes(label)));},
    async click(label){const button=h.button(label);assert.ok(button,'missing '+label);assert.ok(!button.props.disabled,'disabled '+label);button.props.onClick();await settle();h.render();},
    unmount(){slots.forEach(slot=>slot?.cleanup?.());},
    cleanup(){h.unmount();globalThis.window=oldWindow;delete globalThis.captureAvailable;delete globalThis.captureStart;delete globalThis.recorderHooks;},
  };h.render();return h;
}

test('one click starts recording; stopping stages one voice attachment for preview without sending',async()=>{
  const h=harness();try{
    const start=h.button('planQueue.recordVoice');start.props.onClick();start.props.onClick();await settle();h.render();
    assert.equal(h.starts,1);assert.equal(h.recorded.length,0);assert.deepEqual(h.busy,[true]);
    await h.click('voice.finishPreview');
    assert.equal(h.stopped,1);assert.equal(h.recorded.length,1);assert.equal(h.recorded[0].kind,'audio');
    assert.equal(h.recorded[0].dataUrl,result.dataUrl);assert.match(h.recorded[0].fileName,/\.webm$/);
    assert.deepEqual(h.busy,[true,false]);assert.equal(h.timers.size,0);
  }finally{h.cleanup();}
});

test('permission failure, unsupported capture and invalid recordings preserve the existing plan',async()=>{
  for(const options of [{available:false},{start:async()=>{throw Error('microphone denied');}},{result:{...result,durationSec:0}},{result:{...result,byteLength:9*1024*1024}},{stop:async()=>{throw Error('capture failed');}}]){
    const h=harness(options);try{
      await h.click('planQueue.recordVoice');
      if(h.button('voice.finishPreview'))await h.click('voice.finishPreview');
      assert.equal(h.recorded.length,0);assert.ok(h.render().some(n=>n.props.role==='alert'));
      assert.ok(h.button('planQueue.recordVoice'));assert.equal(h.timers.size,0);
      if(h.busy.length)assert.equal(h.busy.at(-1),false);
    }finally{h.cleanup();}
  }
});

test('cancel and closing the dialog release capture and ignore late permission or stop results',async()=>{
  for(const close of [false,true]){
    let resolve;const h=harness({start:()=>new Promise(done=>{resolve=done;})});try{
      await h.click('planQueue.recordVoice');
      if(close)h.unmount();else await h.click('tooltip.deleteRecording');
      resolve(h.session);await settle();
      assert.equal(h.cancelled,1);assert.equal(h.recorded.length,0);assert.equal(h.busy.at(-1),false);
    }finally{h.cleanup();}
  }
  let resolve;const h=harness({stop:()=>new Promise(done=>{resolve=done;})});try{
    await h.click('planQueue.recordVoice');await h.click('voice.finishPreview');h.unmount();resolve(result);await settle();
    assert.equal(h.recorded.length,0);assert.equal(h.cancelled,1);assert.equal(h.timers.size,0);
  }finally{h.cleanup();}
});

test('the duration limit stops recording into preview and a disabled recorder cannot request the microphone',async()=>{
  const h=harness({seconds:599});try{
    await h.click('planQueue.recordVoice');for(const tick of h.timers)tick();await settle();h.render();
    assert.equal(h.stopped,1);assert.equal(h.recorded.length,1);assert.equal(h.timers.size,0);
  }finally{h.cleanup();}
  const disabled=harness({disabled:true});try{
    assert.equal(disabled.button('planQueue.recordVoice').props.disabled,true);
    disabled.button('planQueue.recordVoice').props.onClick();await settle();assert.equal(disabled.starts,0);
  }finally{disabled.cleanup();}
});
