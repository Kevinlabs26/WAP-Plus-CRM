import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const mocks={
 'lucide-react':'export const Activity="icon",ArrowDownToLine="icon",ArrowUpFromLine="icon",Database="icon",Sparkles="icon";',
 react:'export const useState=v=>globalThis.settingsHooks.state(v);export const useRef=v=>globalThis.settingsHooks.ref(v);export const useEffect=(f,d)=>globalThis.settingsHooks.effect(f,d);export const useSyncExternalStore=(_s,get)=>get();',
 'react/jsx-runtime':'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";',
 '@/i18n':'export const useI18n=()=>({t:key=>key});',
 '@/components/ui/primitives':'export const Button="button",Input="input";',
 '@/lib/bridge':'export const isTauri=()=>true;',
 '@/lib/vertexAi':'export const vertexStatus=()=>globalThis.vertexUi.status();export const saveVertexCredentials=value=>globalThis.vertexUi.save(value);export const removeVertexCredentials=async()=>{};export const vertexAccessToken=async()=>"test-token";',
 '@/lib/aiUsage':`export {summarizeAiUsage,usageDay,usageRateKey} from ${JSON.stringify('./src/lib/aiUsage.ts')};export const getAiUsageSnapshot=()=>globalThis.usageUi;export const subscribeAiUsage=()=>()=>{};export const saveAiUsageRate=async()=>{};export const clearAiUsageRate=async()=>{};`,
 '@/lib/aiPricing':`export * from ${JSON.stringify('./src/lib/aiPricing.ts')};`,
};
const built=await build({stdin:{contents:`export {VertexAiFields} from './src/components/settings/VertexAiFields.tsx';export {AiUsagePanel} from './src/components/settings/AiUsagePanel.tsx';`,resolveDir:root},bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'ui-boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],resolveDir:root}));}}]});
const {VertexAiFields,AiUsagePanel}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text+'\n//# sourceURL=ai-settings-usage-vertex-ui.js').toString('base64'));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree?.props?[tree,...nodes(tree.props.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree?.props?text(tree.props.children):typeof tree==='string'||typeof tree==='number'?String(tree):'';
const settle=async()=>{for(let i=0;i<3;i++)await new Promise(resolve=>setImmediate(resolve));};
const saved={configured:true,projectId:'imported-project',email:'test@imported-project.iam.gserviceaccount.com',credentialId:'a'.repeat(64)};
function fixture(settings={}){
 const slots=[],effects=[];let cursor=0;
 globalThis.settingsHooks={state(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>slots[i]=value];},ref(initial){const i=cursor++;return slots[i]??={current:initial};},effect(fn){const i=cursor++;if(!(i in slots)){slots[i]=true;effects.push(fn);}}};
 const patches=[],imports=[],props={settings:{vertexProjectId:'',vertexLocation:'global',vertexCredentialId:'',aiModel:'',...settings},updateSettings(patch){patches.push(patch);props.settings={...props.settings,...patch};}};
 globalThis.vertexUi={status:async()=>({configured:false,projectId:null,credentialId:null}),save:async value=>{imports.push(value);return saved;}};
 return {props,patches,imports,render(Component=VertexAiFields){cursor=0;const tree=nodes(Component(props));for(const effect of effects.splice(0))effect();return tree;},import(tree,value={size:20,text:async()=>'{"private_key":"test-only-import"}'}){const target={files:[value],value:'file.json'};tree.find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target});return target;}};
}

test('import comes first, detects project automatically and stores no JSON in ordinary settings',async()=>{
 const h=fixture();let tree=h.render();await settle();tree=h.render();assert.equal(tree.filter(n=>n.type==='input'&&n.props.type!=='file').length,0);assert.ok(tree.some(n=>text(n)==='vertex.autoProject'));
 const target=h.import(tree);assert.equal(target.value,'');await settle();tree=h.render();assert.equal(h.props.settings.vertexProjectId,'imported-project');assert.equal(h.props.settings.vertexLocation,'global');assert.ok(tree.some(n=>n.type==='input'&&n.props.value==='imported-project'));
 assert.equal(h.imports.length,1);assert.ok(!JSON.stringify(h.patches).includes('private_key'));
});

test('saved credentials refill an empty project on reopening but preserve an explicitly chosen target project',async()=>{
 for(const project of ['','other-project']){const h=fixture({vertexProjectId:project});vertexUi.status=async()=>saved;h.render();await settle();assert.equal(h.props.settings.vertexProjectId,project||'imported-project');assert.equal(h.props.settings.vertexCredentialId,saved.credentialId);}
});

test('a late initial credential lookup cannot overwrite a newer import',async()=>{
 const h=fixture();let release;vertexUi.status=()=>new Promise(resolve=>release=resolve);const tree=h.render();h.import(tree);await settle();release({...saved,projectId:'old-project',credentialId:'b'.repeat(64)});await settle();
 assert.equal(h.props.settings.vertexProjectId,'imported-project');assert.equal(h.props.settings.vertexCredentialId,saved.credentialId);
});

test('oversized JSON fails before reading or saving any credentials',async()=>{
 const h=fixture();h.import(h.render(),{size:32769,text:()=>{throw Error('must not read');}});await settle();assert.equal(h.imports.length,0);assert.ok(h.render().some(n=>n.props.role==='alert'&&text(n).includes('vertex.tooLarge')));
});

test('usage cards and feature rows label partial costs and missing token reports',()=>{
 const h=fixture(),at=new Date(),day=`${at.getFullYear()}-${String(at.getMonth()+1).padStart(2,'0')}-${String(at.getDate()).padStart(2,'0')}`;
 const row={day,provider:'vertex',model:'test',service:'vertex:1',feature:'outreach',requests:2,failed:0,unknown:1,input:1000,output:500,cached:0,total:1500,reportedCost:0,reportedRequests:0,unpricedInput:1000,unpricedOutput:500,unpricedCached:0};
 globalThis.usageUi={buckets:[row],rates:{'["vertex:1","test"]':{input:2,output:4}},error:false,limited:false};const tree=h.render(AiUsagePanel);
 assert.ok(tree.some(n=>n.type==='h3'&&text(n)==='aiUsage.title'));assert.match(text(tree),/1,500 Token/);assert.match(text(tree),/\$0\.0040 \+ \?/);assert.ok(tree.some(n=>text(n)==='aiUsage.unknown'));assert.ok(tree.some(n=>text(n).includes('aiUsage.outreach')));
 usageUi={...usageUi,rates:{}};assert.ok(h.render(AiUsagePanel).some(n=>text(n)==='aiUsage.unpriced'));
});

test('known models automatically show official prices and their source without requiring manual entry',()=>{
 const h=fixture(),at=new Date(),day=`${at.getFullYear()}-${String(at.getMonth()+1).padStart(2,'0')}-${String(at.getDate()).padStart(2,'0')}`;
 const row={day,provider:'openai',model:'gpt-5.6-luna',service:'openai:1',feature:'suggestion',requests:1,failed:0,unknown:0,input:1000,output:500,cached:0,total:1500,reportedCost:0,reportedRequests:0,unpricedInput:1000,unpricedOutput:500,unpricedCached:0};
 globalThis.usageUi={buckets:[row],rates:{},error:false,limited:false};const tree=h.render(AiUsagePanel);assert.match(text(tree),/\$0\.0008/);assert.ok(!tree.some(n=>text(n)==='aiUsage.unpriced'));
 const price=tree.find(n=>typeof n.type==='function'&&n.type.name==='ModelPriceRow');assert.ok(price);const rendered=nodes(price.type(price.props));assert.ok(text(rendered).includes('aiUsage.officialPrice'));assert.ok(rendered.some(n=>n.type==='a'&&n.props.href==='https://developers.openai.com/api/docs/models/gpt-5.6-luna'));
 assert.ok(text(rendered).includes('$0.2'));assert.ok(text(rendered).includes('aiUsage.customPrice'));
});
