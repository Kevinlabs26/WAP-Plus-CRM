import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const mocks = {
  react: `export const forwardRef=f=>f,memo=f=>f,useCallback=f=>f,useMemo=f=>f(),useRef=current=>({current}),useState=v=>[v,()=>{}],useId=()=>"test",useEffect=()=>{},useImperativeHandle=()=>{};`,
  'react/jsx-runtime': `export const jsx=(type,props)=>({type,props});export const jsxs=jsx;`,
  'react-virtuoso': 'export const Virtuoso=()=>null;',
  '@/components/ui/primitives': 'export const EmptyState=()=>null;',
  '@/lib/syncDebug': 'export const syncLog=()=>{};',
  '@/lib/storage': 'export const loadMessagesPage=opts=>globalThis.historyPage(opts);',
  '@/i18n': 'export const useI18n=()=>({t:k=>k});',
  'lucide-react': 'export const ArrowDown=()=>null;',
  './MessageBubble': 'export const MessageBubble=()=>null;',
  './messageMediaUtils': 'export const shouldAutoLoadMessageMedia=()=>false;',
  '@/store/messageMemory': 'export const retainMessageViewport=()=>{};',
};
const src=fileURLToPath(new URL('../src',import.meta.url));
const built=await build({stdin:{contents:`export {MessageList} from './components/chat/MessageList';export {loadChatHistoryPage} from './lib/chatHistory';`,resolveDir:src},
  bundle:true,format:'esm',platform:'browser',write:false,jsx:'automatic',alias:{'@':src},plugins:[{name:'history-boundaries',setup(b){
    b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);
    b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));
  }}]});
const {MessageList,loadChatHistoryPage}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};

test('scrolling sparse memory reads through missing middle days using disk page cursors',async()=>{
  const memory=[{id:'nov4',sentAt:'2026-11-04T10:00:00Z'},{id:'nov9',sentAt:'2026-11-09T10:00:00Z'}];
  const missing={id:'nov6',sentAt:'2026-11-06T10:00:00Z'};
  const requested=[];
  globalThis.historyPage=async opts=>{
    requested.push(opts.beforeId??null);
    if(!opts.beforeId)return {items:[memory[1]],limit:1};
    if(opts.beforeId==='nov9')return {items:[missing],limit:1};
    return {items:[memory[0]],limit:80};
  };
  try{
    const tree=MessageList({chatId:'chat',messages:memory,onLoadOlderFromDisk:(id,cursor)=>loadChatHistoryPage(id,cursor,items=>{
      let added=0;for(const item of items)if(!memory.some(m=>m.id===item.id)){memory.push(item);added++;}return added;
    })},null);
    const list=tree.props.children.find(child=>child?.props?.atTopStateChange);
    list.props.atTopStateChange(true);await settle();
    assert.deepEqual(requested,[null,'nov9']);
    assert.ok(memory.some(m=>m.id==='nov6'),'the gap must be filled before going farther back than November 4');
    list.props.atTopStateChange(true);await settle();
    assert.deepEqual(requested,[null,'nov9','nov6']);
    list.props.atTopStateChange(true);await settle();
    assert.equal(requested.length,3,'the disk end stops further requests');
  }finally{delete globalThis.historyPage;}
});
