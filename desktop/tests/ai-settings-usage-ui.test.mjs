import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const mocks={
 'lucide-react':'export const Activity="icon",ArrowDownToLine="icon",ArrowUpFromLine="icon",Database="icon",Sparkles="icon";',
 react:'export const useState=v=>[typeof v==="function"?v():v,()=>{}];export const useSyncExternalStore=(_s,get)=>get();',
 'react/jsx-runtime':'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";',
 '@/i18n':'export const useI18n=()=>({t:key=>key,locale:"en-US"});',
 '@/components/ui/primitives':'export const Button="button",Input="input";',
 '@/lib/aiUsage':'export {summarizeAiUsage,usageDay,usageRateKey} from "./src/lib/aiUsage.ts";export const getAiUsageSnapshot=()=>globalThis.usageUi;export const subscribeAiUsage=()=>()=>{};export const saveAiUsageRate=async()=>{};export const clearAiUsageRate=async()=>{};',
 '@/lib/aiPricing':'export * from "./src/lib/aiPricing.ts";',
};
const built=await build({stdin:{contents:"export {AiUsagePanel} from './src/components/settings/AiUsagePanel.tsx';",resolveDir:root},bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'ui-boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],resolveDir:root}));}}]});
const {AiUsagePanel}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text+'\n//# sourceURL=ai-settings-usage-ui.js').toString('base64'));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree?.props?[tree,...nodes(tree.props.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree?.props?text(tree.props.children):typeof tree==='string'||typeof tree==='number'?String(tree):'';
const render=()=>nodes(AiUsagePanel());
const today=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};

test('usage cards and feature rows label partial costs and missing token reports',()=>{
 const day=today();
 const row={day,provider:'openai',model:'test',service:'openai:1',feature:'outreach',requests:2,failed:0,unknown:1,input:1000,output:500,cached:0,total:1500,reportedCost:0,reportedRequests:0,unpricedInput:1000,unpricedOutput:500,unpricedCached:0};
 globalThis.usageUi={buckets:[row],rates:{'["openai:1","test"]':{input:2,output:4}},error:false,limited:false};const tree=render();
 assert.ok(tree.some(n=>n.type==='h3'&&text(n)==='aiUsage.title'));assert.match(text(tree),/1,500 Token/);assert.match(text(tree),/\$0\.0040 \+ \?/);assert.ok(tree.some(n=>text(n)==='aiUsage.unknown'));assert.ok(tree.some(n=>text(n).includes('aiUsage.outreach')));
 usageUi={...usageUi,rates:{}};assert.ok(render().some(n=>text(n)==='aiUsage.unpriced'));
});

test('known models automatically show official prices and their source without requiring manual entry',()=>{
 const day=today();
 const row={day,provider:'openai',model:'gpt-5.6-luna',service:'openai:1',feature:'suggestion',requests:1,failed:0,unknown:0,input:1000,output:500,cached:0,total:1500,reportedCost:0,reportedRequests:0,unpricedInput:1000,unpricedOutput:500,unpricedCached:0};
 globalThis.usageUi={buckets:[row],rates:{},error:false,limited:false};const tree=render();assert.match(text(tree),/\$0\.0008/);assert.ok(!tree.some(n=>text(n)==='aiUsage.unpriced'));
 const price=tree.find(n=>typeof n.type==='function'&&n.type.name==='ModelPriceRow');assert.ok(price);const rendered=nodes(price.type(price.props));assert.ok(text(rendered).includes('aiUsage.officialPrice'));assert.ok(rendered.some(n=>n.type==='a'&&n.props.href==='https://developers.openai.com/api/docs/models/gpt-5.6-luna'));
 assert.ok(text(rendered).includes('$0.2'));assert.ok(text(rendered).includes('aiUsage.customPrice'));
});
