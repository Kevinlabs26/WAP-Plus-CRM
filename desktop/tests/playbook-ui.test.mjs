import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const mocks = {
  react: 'export const useEffect=()=>{};export const useCallback=callback=>callback;export const useState=value=>globalThis.playbookHooks.state(value);export const useRef=value=>globalThis.playbookHooks.ref(value);',
  'react/jsx-runtime':'export const Fragment="fragment";export const jsx=(type,props)=>({type,props});export const jsxs=jsx;',
  '@/store/appStore':'export const useAppStore=selector=>{const value=selector(globalThis.playbookState);if(!Object.is(value,selector(globalThis.playbookState)))throw Error("Unstable store snapshot");return value;};useAppStore.getState=()=>globalThis.playbookState;',
  '@/i18n':'export const useI18n=()=>({t:(key,params)=>key+(params?JSON.stringify(params):"")});',
  '@/components/ui/primitives':'export const Button="button",Input="input",Textarea="textarea";',
  '@/components/ui/TimeZoneSelect':'export const TimeZoneSelect="time-zone";',
  '@/lib/musePlaybookSync':'export const inferredMuseFolder=()=>"";export const normalizeMuseFolder=v=>v.trim();export const syncMusePlaybooks=async(_refresh,folder)=>{globalThis.playbookSyncRoot=folder;return 0;};export const discoverMusePlaybookSources=async()=>globalThis.playbookSources||[];',
  '@/lib/museWeb':'export const museWebAccounts=async()=>({accounts:[],selectedId:"",primaryId:""});export const openMuseWeb=async()=>{};',
};
const src=fileURLToPath(new URL('../src',import.meta.url));
const bundle=await build({stdin:{contents:`export {PlaybookLibrary} from './components/settings/PlaybookLibrary';export {PlaybookPlans} from './components/settings/PlaybookPlans';export {PlaybookSelect,PlaybookBinding} from './components/crm/PlaybookBinding';export {ChatPromptPlan} from './components/crm/ChatPromptPlan';export {PromptPlanFields,PromptPlanBindingFields} from './components/settings/PromptPlanFields';export {PromptPlanLibrary} from './components/settings/PromptPlanLibrary';export {SettingsPromptPlansPanel} from './components/settings/SettingsPromptPlansPanel';`,resolveDir:src},bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',alias:{'@':src},plugins:[{name:'playbook-ui',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {PlaybookLibrary,PlaybookSelect,PlaybookBinding,PlaybookPlans,ChatPromptPlan,PromptPlanFields,PromptPlanBindingFields,PromptPlanLibrary,SettingsPromptPlansPanel}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree?.props?[tree,...nodes(tree.props.children)]:[];
const settle=async()=>{for(let i=0;i<50;i++)await Promise.resolve();};
function fixture(){
  let cells=[],cursor=0;
  globalThis.playbookHooks={state(value){const i=cursor++;if(!(i in cells))cells[i]=value;return[cells[i],next=>{cells[i]=next;}];},ref(value){const i=cursor++;if(!(i in cells))cells[i]={current:value};return cells[i];}};
  globalThis.playbookState={settings:{aiPlaybooks:[],aiPlaybookBindings:{},chatFolders:[],aiPlaybookAutoSync:false},updateSettings(patch){this.settings={...this.settings,...patch};},pushToast(){},requestConfirm:async()=>true};
  return {render(Component=PlaybookLibrary){cursor=0;return nodes(Component());}};
}

test('library imports actual filenames for selection without exposing content editing',async()=>{
  const ui=fixture();
  assert.equal(nodes(PlaybookSelect({value:'',onChange(){}})).filter(node=>node.type==='option').length,2,'only inherit and off exist before import');
  const input=ui.render().find(node=>node.type==='input'&&node.props.type==='file');
  input.props.onChange({target:{files:[{name:'My custom stage.md',size:30,text:async()=> 'Real stage rules'}],value:'file'}});
  await settle();
  let tree=ui.render();
  assert.equal(playbookState.settings.aiPlaybooks.length,1);
  assert.equal(playbookState.settings.aiPlaybooks[0].name,'My custom stage');
  assert.ok(nodes(PlaybookSelect({value:'',onChange(){}})).some(node=>node.type==='option'&&JSON.stringify(node.props.children).includes('My custom stage')));
  assert.equal(tree.some(node=>node.type==='textarea'),false);
  assert.equal(tree.some(node=>node.type==='input'&&node.props.type!=='file'&&node.props.placeholder!=='playbook.scopePlaceholder'),false);
  assert.equal(tree.some(node=>node.type==='button'&&['dialog.save','common.delete'].includes(node.props.children)),false);
});

test('local Markdown retains its full original content within the import capacity',async()=>{
  const ui=fixture();
  const input=ui.render().find(node=>node.type==='input'&&node.props.type==='file');
  input.props.onChange({target:{files:[{name:'Long stage.md',size:6001,text:async()=> 'x'.repeat(6001)}],value:'file'}});
  await settle();
  assert.equal(playbookState.settings.aiPlaybooks.length,1);assert.equal(playbookState.settings.aiPlaybooks[0].content.length,6001);assert.ok(!ui.render().some(node=>node.props.role==='alert'));
});
test('Muse sync imports only the user-entered relative folder without enabling automatic checks',async()=>{const ui=fixture();const folder='解决观念/playbooks';let tree=ui.render();tree.find(n=>n.type==='input'&&n.props.placeholder==='playbook.scopePlaceholder').props.onChange({target:{value:folder}});tree=ui.render();tree.find(n=>n.type==='button'&&n.props.children==='playbook.findSources').props.onClick();await settle();assert.equal(playbookSyncRoot,folder);assert.equal(playbookState.settings.aiPlaybookAutoSync,false);delete globalThis.playbookSyncRoot;});


test('customer picker saves only the current account conversation, and inherit clears the override',()=>{
  fixture();
  playbookState.settings.aiProvider='muse';
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

test('chat Playbook follows the current AI provider and opens its library for Muse', () => {
  fixture();
  const binding = {'["a","chat"]':'one'};
  playbookState.settings.aiPlaybookBindings = binding;
  playbookState.settings.aiOutreachMuseAccountId = 'saved-muse-account';
  const calls = [];
  playbookState.setSettingsCategory = category => calls.push(category);
  playbookState.setSettingsOpen = open => calls.push(open);
  const render = () => nodes(PlaybookBinding({accountId:'a',chatId:'chat'}));
  for (const aiProvider of ['gemini', 'vertex', 'openai']) {
    playbookState.settings.aiProvider = aiProvider;
    assert.deepEqual(render(), [], aiProvider);
    assert.equal(playbookState.settings.aiPlaybookBindings, binding);
  }
  playbookState.settings.aiProvider = 'muse';
  const muse = render();
  assert.equal(muse.find(node => node.type === PlaybookSelect).props.value, 'one');
  muse.find(node => node.props.children === 'playbook.manage').props.onClick();
  assert.deepEqual(calls, ['playbook', true]);
});

test('chat prompt plan selects a reusable daily rotation and can return to folder inheritance', () => {
 const ui = fixture();
 playbookState.settings.aiPromptTemplates = [
  { id: 'a', name: 'Intro', prompt: 'First' },
  { id: 'b', name: 'Quote', prompt: 'Second' },
 ];
 playbookState.settings.aiPromptPlans = [{ id: 'daily-plan', name: 'Daily plan', plan: { mode: 'rotation', templateIds: ['a', 'b'], loop: true } }];
 playbookState.settings.aiTimeZone = 'Europe/Paris';
 const props = { accountId: 'a', chatId: 'chat', inherited: {}, now: Date.parse('2026-11-23T08:00:00Z') };
 const render = () => ui.render(() => ChatPromptPlan(props));
 const fields = () => nodes(PromptPlanBindingFields(render().find(node => node.type === PromptPlanBindingFields).props));
 const select = (index, value) => fields().filter(node => node.type === 'select')[index].props.onChange({ target: { value } });
 const button = (tree, label) => tree.find(node => node.type === 'button' && node.props.children === label);
 select(0, 'daily-plan');
 button(render(), 'dialog.save').props.onClick();
 assert.deepEqual(playbookState.settings.aiPromptPlanByChat['["a","chat"]'], {
  mode: 'saved', planId: 'daily-plan', startDate: '2026-11-23', switchTime: '09:00', timeZone: 'Europe/Paris',
 });
 select(0, '');
 button(render(), 'dialog.save').props.onClick();
 assert.deepEqual(playbookState.settings.aiPromptPlanByChat, {});
});

test('settings prompt plans panel exposes the reusable plan library', () => {
 const ui = fixture();
 const panel = ui.render(() => SettingsPromptPlansPanel());
 assert.ok(panel.some(node => node.type === PromptPlanLibrary));
});

test('editing an in-use fixed plan into rotation initializes only missing binding schedules', () => {
 const ui = fixture();
 const reference = { mode: 'saved', planId: 'shared' };
 playbookState.settings.aiTimeZone = 'Europe/Paris';
 playbookState.settings.aiPromptTemplates = [
  { id: 'a', name: 'Intro', prompt: 'First' },
  { id: 'b', name: 'Follow-up', prompt: 'Second' },
 ];
 playbookState.settings.aiPromptPlans = [{ id: 'shared', name: 'Shared', plan: { mode: 'fixed', templateId: 'a' } }];
 playbookState.settings.chatFolders = [
  { id: 'f', name: 'Prospects', aiPromptPlan: reference },
  { id: 'preserve', name: 'Preserve', aiPromptPlan: { ...reference, startDate: '2026-01-10', switchTime: '08:30', timeZone: 'America/New_York' } },
  { id: 'other', name: 'Other' },
 ];
 playbookState.settings.aiPromptPlanByChat = { '["a","chat"]': reference, '["a","untouched"]': { mode: 'saved', planId: 'another' } };
 const render = () => ui.render(() => PromptPlanLibrary());
 render().find(node => node.type === PromptPlanFields).props.onChange({ mode: 'rotation', templateIds: ['a', 'b'], loop: true });
 render().find(node => node.type === 'button' && node.props.children === 'dialog.save').props.onClick();
 const saved = playbookState.settings.aiPromptPlans[0];
 assert.deepEqual(saved.plan, { mode: 'rotation', templateIds: ['a', 'b'], loop: true });
 const [folder, preserved, other] = playbookState.settings.chatFolders;
 assert.match(folder.aiPromptPlan.startDate, /^\d{4}-\d{2}-\d{2}$/);
 assert.equal(folder.aiPromptPlan.switchTime, '09:00');
 assert.equal(folder.aiPromptPlan.timeZone, 'Europe/Paris');
 assert.deepEqual(preserved.aiPromptPlan, { ...reference, startDate: '2026-01-10', switchTime: '08:30', timeZone: 'America/New_York' });
 assert.equal(other.aiPromptPlan, undefined);
 assert.match(playbookState.settings.aiPromptPlanByChat['["a","chat"]'].startDate, /^\d{4}-\d{2}-\d{2}$/);
 assert.deepEqual(playbookState.settings.aiPromptPlanByChat['["a","untouched"]'], { mode: 'saved', planId: 'another' });
});

test('invalid saved time zones cannot crash folder or chat plan settings', () => {
 fixture();
 playbookState.settings.aiTimeZone = 'Europe/Paris';
 playbookState.settings.aiPromptPlans = [{ id: 'rotation', name: 'Rotation', plan: { mode: 'rotation', templateIds: ['daily'], loop: true } }];
 const tree = nodes(PromptPlanBindingFields({
  value: { mode: 'saved', planId: 'rotation', startDate: '2026-11-23', switchTime: '09:00', timeZone: 'Invalid/Zone' },
  onChange() {}, inheritLabel: 'inherit',
 }));
 assert.equal(tree.find(node => node.type === 'time-zone').props.value, 'Europe/Paris');
});

test('removed Muse files disappear from binding choices and the library has no shared overview selector',()=>{
 const ui=fixture();
 playbookState.settings.aiPlaybooks=[{id:'old',name:'Old stage',content:'',summary:'Old rules',musePath:'/books/old.md',museMissing:true},{id:'current',name:'Current stage',content:'',summary:'Current rules',musePath:'/books/current.md'}];
 const options=value=>nodes(PlaybookSelect({value,onChange(){}})).filter(n=>n.type==='option');
 assert.ok(!options('').some(n=>n.props.value==='old'));
 assert.ok(options('').some(n=>n.props.value==='current'));
 assert.equal(options('old').find(n=>n.props.value==='old').props.disabled,true);
 assert.equal(ui.render().filter(n=>n.type==='select').length,0);
 assert.ok(ui.render().some(n=>n.type===PlaybookPlans));
 assert.equal(playbookState.settings.aiPlaybooks.length,2,'hiding expired entries does not destroy cached data');
});

test('conversation plans save reusable daily Playbook references and reject deletion while assigned',async()=>{
 const ui=fixture();playbookState.settings.aiPlaybooks=[{id:'one',name:'One',content:'',summary:'Rules'}];
 let tree=ui.render(PlaybookPlans);tree.find(n=>n.type==='button'&&n.props.children==='plan.create').props.onClick();
 tree=ui.render(PlaybookPlans);tree.find(n=>n.type==='input').props.onChange({target:{value:'Seven day welcome'}});
 tree=ui.render(PlaybookPlans);tree.filter(n=>n.type==='select')[1].props.onChange({target:{value:'one'}});
 tree=ui.render(PlaybookPlans);tree.find(n=>n.type==='button'&&n.props.children==='dialog.save').props.onClick();
 const plan=playbookState.settings.aiPlaybookPlans[0];assert.equal(plan.name,'Seven day welcome');assert.deepEqual(plan.days,['one']);
 playbookState.settings.chatFolders=[{id:'f',chatIds:[],aiPlaybookSchedule:{planId:plan.id,startDate:'2026-11-11',timeZone:'UTC',switchTime:'09:00'}}];
 tree=ui.render(PlaybookPlans);assert.equal(tree.find(n=>n.type==='button'&&n.props.children==='common.delete').props.disabled,true);
});
