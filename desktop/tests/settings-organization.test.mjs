import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const mocks={
 react:'export const useState=v=>[v,()=>{}];export const useRef=v=>({current:v});export const useEffect=()=>{};',
 '@/lib/desktopNotify':'export const getNotifyPermission=async()=>"granted";export const ensureNotifyPermission=async()=>globalThis.notificationGrant;',
 'react/jsx-runtime':'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";',
 '@/store/appStore':'export const useAppStore=selector=>selector(globalThis.organizationState);',
 '@/components/ui/primitives':'export const Input="input",SectionLabel="h4";',
 '@/i18n':'export const useI18n=()=>({t:k=>k});',
};
const built=await build({stdin:{contents:`export { SettingsMessagingPanel } from './src/components/settings/SettingsMessagingPanel.tsx';export { SettingsNotificationsPanel } from './src/components/settings/SettingsNotificationsPanel.tsx';`,resolveDir:fileURLToPath(new URL('../',import.meta.url))},bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',alias:{'@':fileURLToPath(new URL('../src',import.meta.url))},plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {SettingsMessagingPanel,SettingsNotificationsPanel}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t?.props?[t,...nodes(t.props.children)]:[];
const text=t=>Array.isArray(t)?t.map(text).join(''):t?.props?text(t.props.children):typeof t==='string'?t:'';
test('group auto-read remains independently editable when desktop notifications are disabled',()=>{
 const updates=[];
 globalThis.organizationState={settings:{desktopNotifyEnabled:false,autoReadGroupMessages:true,notificationPrivacy:'hidden'},updateSettings:patch=>updates.push(patch)};
 try {
  const messaging=SettingsMessagingPanel(),notifications=SettingsNotificationsPanel();
  assert.ok(!text(messaging).includes('settingsMessaging.notificationsHint'));
  assert.ok(!text(notifications).includes('settingsMessaging.autoReadGroups'));
  assert.ok(text(notifications).includes('settingsMessaging.notificationPrivacy'));
  const label=nodes(messaging).find(node=>node.type==='label'&&text(node).includes('settingsMessaging.autoReadGroups'));
  const checkbox=nodes(label).find(node=>node.type==='input');
  assert.equal(checkbox.props.checked,true);assert.ok(!checkbox.props.disabled);
  function ancestors(tree,target,path=[]) { if(tree===target)return path;if(Array.isArray(tree)){for(const child of tree){const found=ancestors(child,target,path);if(found)return found;}}else if(tree?.props)return ancestors(tree.props.children,target,[...path,tree]); }
  assert.ok(ancestors(messaging,checkbox).every(node=>!String(node.props.className).includes('pointer-events-none')));
  checkbox.props.onChange({target:{checked:false}});
  assert.deepEqual(updates,[{autoReadGroupMessages:false}]);
 }finally{delete globalThis.organizationState;}
});

test('notification enable only persists after authorization and rejection leaves it off', async()=>{
 const updates=[];
 globalThis.organizationState={settings:{desktopNotifyEnabled:false},updateSettings:patch=>updates.push(patch)};
 try {
  globalThis.notificationGrant=false;
  const checkbox=nodes(SettingsNotificationsPanel()).find(node=>node.type==='input');
  await checkbox.props.onChange({target:{checked:true}});
  assert.deepEqual(updates,[{desktopNotifyEnabled:false}]);
  globalThis.notificationGrant=true;
  await checkbox.props.onChange({target:{checked:true}});
  assert.deepEqual(updates.at(-1),{desktopNotifyEnabled:true});
 }finally{delete globalThis.organizationState;delete globalThis.notificationGrant;}
});

test('disabled sending and follow-up sections use native fieldsets while independent switches remain usable',()=>{
 globalThis.organizationState={settings:{rateLimitEnabled:false,autoFollowUpEnabled:false},updateSettings:()=>{}};
 try {
  const tree=SettingsMessagingPanel();
  const fieldsets=nodes(tree).filter(node=>node.type==='fieldset');
  assert.equal(fieldsets.length,2);assert.ok(fieldsets.every(node=>node.props.disabled===true));
  assert.ok(!nodes(tree).some(node=>String(node.props.className).includes('pointer-events-none')));
  assert.ok(nodes(tree).filter(node=>node.props.type==='checkbox').length>0);
  globalThis.organizationState.settings={rateLimitEnabled:true,autoFollowUpEnabled:true};
  assert.ok(nodes(SettingsMessagingPanel()).filter(node=>node.type==='fieldset').every(node=>node.props.disabled===false));
 }finally{delete globalThis.organizationState;}
});
