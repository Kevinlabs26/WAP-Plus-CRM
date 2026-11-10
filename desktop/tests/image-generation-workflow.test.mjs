import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';

const root=fileURLToPath(new URL('../',import.meta.url));
const bundle=await build({stdin:{contents:`export * from './src/lib/imageGenerationRequest.ts';export * from './src/lib/imageGenerationReferences.ts';export {openAiGenerateImage} from './src/lib/openAiImage.ts';export {geminiGenerateImage} from './src/lib/gemini.ts';export {normalizeLoadedSettings} from './src/store/settingsDefaults.ts';export {buildSettingsSafe,parseBackupJson} from './src/lib/exportData.ts';`,resolveDir:root},bundle:true,write:false,format:'esm',platform:'node',alias:{'@':root+'src'},plugins:[{name:'store',setup(b){
 b.onResolve({filter:/store\/appStore$/},()=>({path:'store',namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const useAppStore=f=>f(globalThis.imageWorkflowStore);useAppStore.getState=()=>globalThis.imageWorkflowStore;'}));
}}]});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
test('subject identity and layout style stay separate with explicit numbered image roles',()=>{
 const subject={title:'Avatar',mimeType:'image/jpeg',data:'c3ViamVjdA=='},style={title:'Card layout',mimeType:'image/jpeg',data:'c3R5bGU='};
 const result=api.imageGenerationReferences(subject,style);assert.deepEqual(result.images,[subject,style]);
 assert.match(result.instructions,/Image 1 is the SUBJECT/);assert.match(result.instructions,/Image 2 is the STYLE AND LAYOUT/);assert.match(result.instructions,/Replace any person.*person from Image 1/);
 assert.deepEqual(api.imageGenerationReferences(null,style).images,[style]);assert.match(api.imageGenerationReferences(null,style).instructions,/Image 1 is the STYLE/);
});
test('both image services receive two ordered images without attaching local titles as API fields',async()=>{
 const original=globalThis.fetch,requests=[];const references=[{title:'Person',mimeType:'image/jpeg',data:'c3ViamVjdA=='},{title:'Layout',mimeType:'image/jpeg',data:'c3R5bGU='}];
 globalThis.fetch=async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return new Response(JSON.stringify(String(url).includes('openai')?{data:[{b64_json:'aW1hZ2U='}]}:{candidates:[{finishReason:'STOP',content:{parts:[{inlineData:{mimeType:'image/png',data:'aW1hZ2U='}}]}}]}),{headers:{'Content-Type':'application/json'}});};
 try{
  const urls=references.map(image=>`data:${image.mimeType};base64,${image.data}`);
  await api.openAiGenerateImage('test-key','Compose the subject and layout','1:1',urls);
  await api.geminiGenerateImage({apiKey:'test-key',prompt:'Compose the subject and layout',referenceImages:references});
  assert.match(requests[0].url,/images\/edits$/);assert.deepEqual(requests[0].body.images,urls.map(image_url=>({image_url})));
  assert.deepEqual(requests[1].body.contents[0].parts.slice(0,2),references.map(({mimeType,data})=>({inlineData:{mimeType,data}})));
 }finally{globalThis.fetch=original;}
});

test('a reference request survives opening a previously unmounted image panel and is consumed once',()=>{
 const original=globalThis.window;globalThis.window=new EventTarget();const calls=[];
 globalThis.imageWorkflowStore={setCrmPanelCollapsed:value=>calls.push(['collapsed',value]),setCrmPanelTab:value=>calls.push(['tab',value])};
 try {
  const request={source:'data:image/jpeg;base64,aW1hZ2U=',title:'Alice',chatId:'original-chat',mode:'portrait'};
  api.requestImageGeneration(request);
  assert.deepEqual(calls,[['collapsed',false],['tab','images']]);
  assert.deepEqual(api.takeImageGenerationRequest(),request);assert.equal(api.takeImageGenerationRequest(),null);
  assert.throws(()=>api.requestImageGeneration({...request,source:'javascript:alert(1)'}));assert.equal(calls.length,2);
 }finally{globalThis.window=original;}
});
test('the last explicit reference wins without mixing pictures or target chats',()=>{
 const original=globalThis.window;globalThis.window=new EventTarget();globalThis.imageWorkflowStore={setCrmPanelCollapsed(){},setCrmPanelTab(){}};
 try{
  api.requestImageGeneration({source:'blob:first',title:'A',chatId:'a',mode:'portrait'});
  api.requestImageGeneration({source:'blob:second',title:'B',chatId:'b',mode:'style'});
  assert.deepEqual(api.takeImageGenerationRequest(),{source:'blob:second',title:'B',chatId:'b',mode:'style'});
 }finally{globalThis.window=original;}
});
test('image prompts normalize and round-trip through settings backup independently of reply prompts',()=>{
 const templates=[{id:'image-1',name:' Carte ',prompt:' Préserve le visage et crée une carte. '}];
 const settings=api.normalizeLoadedSettings({imagePromptTemplates:templates,aiPromptTemplates:[{id:'reply-1',name:'Reply',prompt:'Answer briefly.'}]});
 assert.equal(settings.imagePromptTemplates[0].name,'Carte');assert.equal(settings.aiPromptTemplates[0].id,'reply-1');
 const safe=api.buildSettingsSafe(settings);
 const restored=api.parseBackupJson({contacts:[{id:'customer',name:'Alice'}],chats:[],messages:[],settingsSafe:safe});
 assert.deepEqual(restored.settingsSafe.imagePromptTemplates,settings.imagePromptTemplates);
 assert.deepEqual(api.normalizeLoadedSettings({}).imagePromptTemplates,[]);
 const bounded=api.normalizeLoadedSettings({imagePromptTemplates:[...templates,...templates,{id:'bad',name:'',prompt:'x'},{id:'long',name:'Long',prompt:'x'.repeat(7000)}]});
 assert.equal(bounded.imagePromptTemplates.length,2);assert.equal(bounded.imagePromptTemplates[1].prompt.length,4000);
});

const dialogSource=await readFile(new URL('../src/components/chat/ImageLibraryPanel.tsx',import.meta.url),'utf8');
const mocks={react:'export const useState=i=>globalThis.imageHooks.state(i);export const useRef=i=>({current:i});export const useEffect=()=>{};export const useMemo=f=>f();',
 'react-virtuoso':'export const Virtuoso="virtual-list";',
 'lucide-react':'export const ImagePlus="icon",Plus="icon",Sparkles="icon",Star="icon";',
 'react/jsx-runtime':'export const Fragment="fragment";export const jsx=(type,props)=>({type,props});export const jsxs=jsx;',
 '@/components/ui/primitives':'export const Button="button";',
 '@/i18n':'export const useI18n=()=>({t:key=>key});',
 '@/store/appStore':'export const useAppStore=f=>f(globalThis.imageWorkflowStore);useAppStore.getState=()=>globalThis.imageWorkflowStore;'};
const dialogBundle=await build({stdin:{contents:`export {ImageGenerationDialog} from 'dialog-source';`,resolveDir:root},bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',alias:{'@':root+'src'},plugins:[{name:'dialog',setup(b){
 b.onResolve({filter:/.*/},args=>args.path==='dialog-source'?{path:'source',namespace:'dialog'}:mocks[args.path]?{path:args.path,namespace:'mock'}:undefined);
 b.onLoad({filter:/.*/,namespace:'dialog'},()=>({contents:dialogSource+'\nexport {ImageGenerationDialog};',loader:'tsx',resolveDir:root+'src/components/chat'}));
 b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path]}));
}}]});
const {ImageGenerationDialog}=await import('data:text/javascript;base64,'+Buffer.from(dialogBundle.outputFiles[0].text).toString('base64'));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree?.props?[tree,...nodes(tree.props.children)]:[];
test('saved image prompts can be created, edited, reused, copied and deleted without generating automatically',()=>{
 const settings={imagePromptTemplates:[]};globalThis.imageWorkflowStore={settings,updateSettings:patch=>Object.assign(settings,patch),pushToast(){}};
 const slots=[];let cursor=0,generated=[];
 const render=()=>{cursor=0;globalThis.imageHooks={state(initial){const index=cursor++;if(!(index in slots))slots[index]=initial;return[slots[index],value=>{slots[index]=value;}];}};return nodes(ImageGenerationDialog({busy:false,error:'',canGenerate:true,generated:null,referenceImage:null,referenceMode:'style',provider:'muse',providerOptions:[],costHint:'',canInsert:false,canCollect:false,onGenerate:options=>generated.push(options)}));};
 let tree=render();tree.find(node=>node.type==='textarea').props.onChange({target:{value:'Create a card preserving the supplied face.'}});
 tree.find(node=>node.type==='input'&&node.props['aria-label']==='gallery.promptName').props.onChange({target:{value:'Portrait card'}});
 tree=render();tree.find(node=>node.props.children==='common.save').props.onClick();assert.equal(settings.imagePromptTemplates.length,1);
 tree=render();tree.find(node=>node.type==='textarea').props.onChange({target:{value:'Updated card prompt'}});tree=render();tree.find(node=>node.props.children==='common.save').props.onClick();assert.equal(settings.imagePromptTemplates.length,1);assert.equal(settings.imagePromptTemplates[0].prompt,'Updated card prompt');
 tree=render();tree.find(node=>node.props.children==='gallery.promptSaveNew').props.onClick();assert.equal(settings.imagePromptTemplates.length,2);
 tree=render();tree.find(node=>node.props.children==='common.delete').props.onClick();assert.equal(settings.imagePromptTemplates.length,1);
 tree=render();const picker=tree.find(node=>node.type==='select'&&nodes(node).some(item=>item.props.children==='gallery.promptCustom'));
 picker.props.onChange({target:{value:settings.imagePromptTemplates[0].id}});tree=render();assert.equal(tree.find(node=>node.type==='textarea').props.value,'Updated card prompt');assert.equal(generated.length,0);
 tree.find(node=>node.props.variant==='primary').props.onClick();assert.equal(generated[0].prompt,'Updated card prompt');
});
