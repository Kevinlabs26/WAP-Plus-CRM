import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const mocks = {
  react: 'export const useState=value=>globalThis.playbookHooks.state(value);export const useRef=value=>globalThis.playbookHooks.ref(value);',
  'react/jsx-runtime':'export const Fragment="fragment";export const jsx=(type,props)=>({type,props});export const jsxs=jsx;',
  '@/store/appStore':'export const useAppStore=selector=>{const value=selector(globalThis.playbookState);if(!Object.is(value,selector(globalThis.playbookState)))throw Error("Unstable store snapshot");return value;};useAppStore.getState=()=>globalThis.playbookState;',
  '@/i18n':'export const useI18n=()=>({t:(key,params)=>key+(params?JSON.stringify(params):"")});',
  '@/components/ui/primitives':'export const Button="button",Input="input",Textarea="textarea";',
  '@/lib/musePlaybookSync':'export const syncMusePlaybooks=async()=>0;',
  '@/lib/museWeb':'export const openMuseWeb=async()=>{};',
};
const src=fileURLToPath(new URL('../src',import.meta.url));
const bundle=await build({stdin:{contents:`export {PlaybookLibrary} from './components/settings/PlaybookLibrary';export {PlaybookSelect,PlaybookBinding} from './components/crm/PlaybookBinding';`,resolveDir:src},bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',alias:{'@':src},plugins:[{name:'playbook-ui',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {PlaybookLibrary,PlaybookSelect,PlaybookBinding}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree?.props?[tree,...nodes(tree.props.children)]:[];
const settle=async()=>{for(let i=0;i<50;i++)await Promise.resolve();};
function fixture(){
  let cells=[],cursor=0;
  globalThis.playbookHooks={state(value){const i=cursor++;if(!(i in cells))cells[i]=value;return[cells[i],next=>{cells[i]=next;}];},ref(value){const i=cursor++;if(!(i in cells))cells[i]={current:value};return cells[i];}};
  globalThis.playbookState={settings:{aiPlaybooks:[],aiPlaybookOverviewId:'',aiPlaybookBindings:{},chatFolders:[]},updateSettings(patch){this.settings={...this.settings,...patch};},pushToast(){},requestConfirm:async()=>true};
  return {render(){cursor=0;return nodes(PlaybookLibrary());}};
}

test('library imports actual filenames and selectable content, with no preset stages',async()=>{
  const ui=fixture();
  assert.equal(nodes(PlaybookSelect({value:'',onChange(){}})).filter(node=>node.type==='option').length,2,'only inherit and off exist before import');
  const input=ui.render().find(node=>node.type==='input'&&node.props.type==='file');
  input.props.onChange({target:{files:[{name:'My custom stage.md',size:30,text:async()=> 'Real stage rules'}],value:'file'}});
  await settle();
  let tree=ui.render();
  assert.equal(playbookState.settings.aiPlaybooks.length,1);
  assert.equal(playbookState.settings.aiPlaybooks[0].name,'My custom stage');
  assert.ok(nodes(PlaybookSelect({value:'',onChange(){}})).some(node=>node.type==='option'&&JSON.stringify(node.props.children).includes('My custom stage')));
  tree.find(node=>node.type==='textarea').props.onChange({target:{value:'Reviewed concise rules'}});
  assert.equal(playbookState.settings.aiPlaybooks[0].summary,'Real stage rules','editing does not commit until save');
  tree=ui.render();tree.find(node=>node.type==='button'&&node.props.children==='dialog.save').props.onClick();
  assert.equal(playbookState.settings.aiPlaybooks[0].summary,'Reviewed concise rules');
  const id=playbookState.settings.aiPlaybooks[0].id;
  playbookState.settings.aiPlaybookBindings['["a","chat"]']=id;
  assert.equal(ui.render().find(node=>node.type==='button'&&node.props.children==='common.delete').props.disabled,true);
});

test('customer picker saves only the current account conversation, and inherit clears the override',()=>{
  fixture();
  playbookState.settings.aiPlaybooks=[{id:'real',name:'Real file',content:'source',summary:'rules',sourceName:'real.md'}];
  const render=()=>nodes(PlaybookBinding({accountId:'a',chatId:'chat'}));
  const picker=()=>render().find(node=>node.type===PlaybookSelect);
  picker().props.onChange('real');
  assert.deepEqual(playbookState.settings.aiPlaybookBindings,{'["a","chat"]':'real'});
  picker().props.onChange('off');
  assert.equal(playbookState.settings.aiPlaybookBindings['["a","chat"]'],'off');
  picker().props.onChange('');
  assert.deepEqual(playbookState.settings.aiPlaybookBindings,{});
  assert.ok(!nodes(PlaybookBinding({chatId:'chat'})).some(node=>node.type===PlaybookSelect),'unknown account cannot create a global override');
});

test('removed Muse files disappear from binding and overview choices, while old bindings stay visible as invalid',()=>{
 const ui=fixture();
 playbookState.settings.aiPlaybooks=[{id:'old',name:'Old stage',content:'',summary:'Old rules',musePath:'/books/old.md',museMissing:true},{id:'current',name:'Current stage',content:'',summary:'Current rules',musePath:'/books/current.md'}];
 const options=value=>nodes(PlaybookSelect({value,onChange(){}})).filter(n=>n.type==='option');
 assert.ok(!options('').some(n=>n.props.value==='old'));
 assert.ok(options('').some(n=>n.props.value==='current'));
 assert.equal(options('old').find(n=>n.props.value==='old').props.disabled,true);
 playbookState.settings.aiPlaybookOverviewId='old';
 const overview=ui.render().find(n=>n.type==='select');
 const opts=nodes(overview).filter(n=>n.type==='option');
 assert.equal(opts.find(n=>n.props.value==='old').props.disabled,true);
 assert.ok(opts.some(n=>n.props.value==='current'));
 assert.equal(playbookState.settings.aiPlaybookOverviewId,'old','never silently change an existing binding');
 const editor=ui.render().filter(n=>n.type==='select')[1];
 assert.ok(!nodes(editor).some(n=>n.type==='option'&&n.props.value==='old'));
 assert.ok(nodes(editor).some(n=>n.type==='option'&&n.props.value==='current'));
 assert.equal(playbookState.settings.aiPlaybooks.length,2,'hiding expired entries does not destroy cached data');
});
