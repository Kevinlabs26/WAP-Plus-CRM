import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

test('auto-reply component scans mode changes after hydration and stops scanning on unmount', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const state = { calls: [], cleanups: [] };
  globalThis.backlogWiring = state;
  const mocks = {
    react: `export const useEffect=fn=>globalThis.backlogWiring.cleanup=fn();`,
    '@/store/appStore': `export const useAppStore={subscribe:fn=>{globalThis.backlogWiring.notify=fn;return ()=>{};},getState:()=>({updateSettings(){},settings:{},messages:[]})};`,
    '@/lib/autoReplyRuntime': `export const useAutoReplyRuntime={subscribe:()=>()=>{}};`,
    '@/lib/aiTaskRecords': `export const updateAiReplyTaskRecords=()=>[];`,
    '@/lib/aiSafety': `export const latestMessagesPerChat=x=>x;`,
    '@/lib/aiOutreach': `export const tickAiOutreach=async()=>{},stopAiOutreach=()=>{},noteOutreachOptOut=()=>{};`,
    '@/lib/appLockRuntime': `export const isAppLockActive=()=>false;`,
    '@/store/messageMemory': `export const retainMessageChats=()=>{};`,
    '@/lib/aiAutoReplyBacklog': `export const createAutoReplyBacklogScheduler=()=>({schedule:previous=>globalThis.backlogWiring.calls.push(previous),stop:()=>globalThis.backlogWiring.stopped=true});`,
    '@/lib/aiAutoReply': `export const onLiveInboundMessages=()=>()=>{},scheduleAutoReplyInbound=()=>{},stopAutoReplies=()=>{},refreshManualTakeovers=()=>{},refreshAutoReplyPause=()=>{},tickAiAutoFollowUps=async()=>{},cancelAiAutoFollowUpsForChat=()=>{},cancelInactiveAiAutoFollowUps=()=>{},stopAiAutoFollowUps=()=>{};`,
  };
  const built = await build({entryPoints:[root+'src/components/bridge/AiAutoReplier.tsx'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'boundaries',setup(b){
    b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);
    b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));
  }}]});
  const previousWindow = globalThis.window;
  globalThis.window = {setInterval:()=>1,clearInterval:()=>{}};
  try {
    const {AiAutoReplier} = await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
    AiAutoReplier();
    const settings = {aiReplyMode:'semi',chatFolders:[]};
    state.notify({hydrated:true,settings:{...settings,aiReplyMode:'auto'}},{hydrated:false,settings});
    assert.equal(state.calls.length,0,'hydration must not replay old chats');
    for (const patch of [{aiReplyMode:'auto'},{chatFolders:[]},{aiAutoReplyPaused:false},{aiAutoReplyModeByChatId:{chat:'auto'}}]) {
      state.notify({hydrated:true,settings:{...settings,...patch}},{hydrated:true,settings});
    }
    assert.equal(state.calls.length,4);
    state.notify({hydrated:true,settings:{...settings,aiModel:'changed'}},{hydrated:true,settings});
    assert.equal(state.calls.length,4,'unrelated settings must not scan');
    state.cleanup();
    assert.equal(state.stopped,true);
  } finally {
    state.cleanup?.();
    globalThis.window = previousWindow;
    delete globalThis.backlogWiring;
  }
});
