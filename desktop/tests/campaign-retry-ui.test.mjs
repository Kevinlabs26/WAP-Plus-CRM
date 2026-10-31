import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const mocks={
 react:'export const useState=()=>[globalThis.retrySelected,v=>{globalThis.retrySelected=typeof v==="function"?v(globalThis.retrySelected):v;}];',
 'react/jsx-runtime':'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;',
 'lucide-react':'export const Pause="pause",Play="play",RotateCcw="retry",Square="square";',
 '@/components/ui/primitives':'export const Button="button";',
 '@/store/appStore':'export const useAppStore=f=>f(globalThis.retryState);',
 '@/i18n':'export const useI18n=()=>({t:(key,p)=>key+(p?JSON.stringify(p):"")});',
};
const out=await build({entryPoints:[fileURLToPath(new URL('../src/components/views/CampaignRunPanel.tsx',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',alias:{'@':fileURLToPath(new URL('../src',import.meta.url))},plugins:[{name:'retry-boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {CampaignRunPanel}=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text+'\n//# sourceURL=campaign-retry-ui-test.js').toString('base64'));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree?.props?[tree,...nodes(tree.props.children)]:[];
test('only selected definite failures use bulk retry; an unknown item has an individual review action',()=>{
 globalThis.retrySelected=[];globalThis.retryState={messages:[],broadcastCampaigns:[{id:'c',status:'paused',items:[{id:'known',contactName:'Known',status:'failed',error:'rejected'},{id:'unknown',contactName:'Unknown',status:'failed',error:'发送结果未知'}]}]};
 const calls=[];const render=()=>nodes(CampaignRunPanel({campaignId:'c',onRetryFailed:(...args)=>calls.push(args)}));
 let ui=render();assert.equal(ui.find(n=>n.props.children?.[1]==='broadcast.run.retryFailed{"count":0}').props.disabled,true);
 ui.find(n=>n.props['aria-label']==='planQueue.selectRetry{"name":"Known"}').props.onChange({target:{checked:true}});
 ui=render();ui.find(n=>n.props.children?.[1]==='broadcast.run.retryFailed{"count":1}').props.onClick();assert.deepEqual(calls[0],[['known']]);
 ui.find(n=>n.props.children==='planQueue.reviewRetry').props.onClick();assert.deepEqual(calls[1],[['unknown'],true]);
 globalThis.retryState.broadcastCampaigns[0].items[0].status='sent';ui=render();assert.equal(ui.find(n=>n.props.children?.[1]==='broadcast.run.retryFailed{"count":0}').props.disabled,true);
});
