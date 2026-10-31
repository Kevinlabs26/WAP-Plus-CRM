import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const mocks = {
  react: 'export const useState = initial => globalThis.folderAiHooks.state(initial);',
  'react/jsx-runtime': 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;',
  '@/i18n': 'export const useI18n=()=>({t:key=>key});',
  '@/components/ui/primitives': 'export const Textarea="textarea";',
  '@/store/appStore': 'export const useAppStore=selector=>selector(globalThis.folderAiState);useAppStore.getState=()=>globalThis.folderAiState;',
};
const built=await build({entryPoints:[fileURLToPath(new URL('../src/components/layout/FolderAiPromptDialog.tsx',import.meta.url))],
  bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',alias:{'@':fileURLToPath(new URL('../src',import.meta.url))},
  plugins:[{name:'folder-prompt-boundaries',setup(b){
    b.onResolve({filter:/.*/},args=>mocks[args.path]?{path:args.path,namespace:'mock'}:undefined);
    b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path]}));
  }}]});
const {FolderAiPromptDialog}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree?.props?[tree,...nodes(tree.props.children)]:[];
function harness(prompt) {
  let slots=[],cursor=0,tree,closed=0;
  const settings={aiReplyMode:'semi',activeAccountId:'a',aiSystemPrompt:'GLOBAL',aiSystemPromptByAccountId:{a:'ACCOUNT'},chatFolders:[
    {id:'parent',name:'Parent',chatIds:[],scope:{type:'account',accountId:'a'},aiSystemPrompt:'PARENT'},
    {id:'f',name:'Folder',chatIds:['chat'],parentId:'parent',scope:{type:'account',accountId:'a'},aiSystemPrompt:prompt},
  ]};
  const state={settings,updateSettings(patch){this.settings={...this.settings,...patch};}};
  globalThis.folderAiState=state;
  globalThis.folderAiHooks={state(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],v=>{slots[i]=v;}];}};
  const h={state,get closed(){return closed;},render(){cursor=0;tree=FolderAiPromptDialog({folderId:'f',onClose(){closed++;}});return tree;},
    select(value){nodes(tree).find(n=>n.type==='select').props.onChange({target:{value}});h.render();},
    type(value){nodes(tree).find(n=>n.type==='textarea').props.onChange({target:{value}});h.render();},
    click(label){nodes(tree).find(n=>n.type==='button'&&n.props.children===label).props.onClick();},nodes(){return nodes(tree);}};
  h.render();return h;
}

test('folder dialog previews inheritance and saves an independent identity without enabling automation',()=>{
 const h=harness();assert.ok(JSON.stringify(h.render()).includes('PARENT'));
 h.select('custom');assert.equal(h.nodes().find(n=>n.type==='textarea').props.maxLength,6000);
 assert.equal(h.nodes().find(n=>n.props.children==='dialog.save').props.disabled,true);
 h.type('  NEW FOLDER ROLE  ');
 h.state.settings={...h.state.settings,chatFolders:h.state.settings.chatFolders.map(f=>f.id==='parent'?{...f,name:'Renamed elsewhere'}:f)};
 h.click('dialog.save');
 assert.equal(h.state.settings.chatFolders.find(f=>f.id==='f').aiSystemPrompt,'NEW FOLDER ROLE');
 assert.equal(h.state.settings.chatFolders[0].name,'Renamed elsewhere');
 assert.equal(h.state.settings.aiReplyMode,'semi');
 assert.equal(h.state.settings.chatFolders.find(f=>f.id==='f').autoReplyMode,undefined);
 assert.equal(h.closed,1);
});

test('inherit clears only the folder override and cancel does not save draft changes',()=>{
 const h=harness('CUSTOM');h.select('inherit');h.click('dialog.save');
 assert.equal(h.state.settings.chatFolders.find(f=>f.id==='f').aiSystemPrompt,undefined);
 assert.equal(h.state.settings.chatFolders[0].aiSystemPrompt,'PARENT');
 const cancelled=harness('OLD');cancelled.type('UNSAVED');cancelled.click('dialog.cancel');
 assert.equal(cancelled.state.settings.chatFolders.find(f=>f.id==='f').aiSystemPrompt,'OLD');
 assert.equal(cancelled.closed,1);
});

test('deleting a folder while its editor is open cannot recreate it',()=>{
 const h=harness('CUSTOM');
 h.state.settings={...h.state.settings,chatFolders:h.state.settings.chatFolders.filter(f=>f.id!=='f')};
 h.click('dialog.save');assert.equal(h.state.settings.chatFolders.some(f=>f.id==='f'),false);
 assert.equal(h.render(),null);
});
