import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const mocks={react:'export const useState=initial=>globalThis.promptHooks(initial);','react/jsx-runtime':'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;',
 '@/store/appStore':'export const useAppStore=selector=>selector(globalThis.promptState);useAppStore.getState=()=>globalThis.promptState;',
 '@/i18n':'export const useI18n=()=>({t:(key,params)=>key+(params?JSON.stringify(params):"")});','@/components/ui/primitives':'export const Button="button",Input="input",Textarea="textarea";'};
const built=await build({entryPoints:[root+'src/components/settings/AiPromptLibrary.tsx'],bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',alias:{'@':root+'src'},plugins:[{name:'library-ui',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {AiPromptLibrary}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text+'\n//# sourceURL=prompt-library-ui.js').toString('base64'));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree?.props?[tree,...nodes(tree.props.children)]:[];
function fixture(){let slots=[],cursor=0;globalThis.promptHooks=initial=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>slots[i]=value];};
 globalThis.promptState={settings:{aiPromptTemplates:[{id:'template',name:'Shared',prompt:'ORIGINAL'}],chatFolders:[{id:'parent',name:'Parent',scope:{type:'account',accountId:'a'},chatIds:[],aiPromptTemplateId:'template'},{id:'child',name:'Child',parentId:'parent',scope:{type:'account',accountId:'a'},chatIds:[]}],aiSystemPrompt:'',aiSystemPromptByAccountId:{},activeAccountId:'a'},updateSettings(patch){this.settings={...this.settings,...patch};},pushToast(){}};
 const render=()=>{cursor=0;return nodes(AiPromptLibrary());};const button=label=>render().find(node=>node.type==='button'&&node.props.children===label);
 return {render,button};}

test('shared template editing shows inherited impact, commits only on save and protects referenced templates from deletion',()=>{
 const h=fixture();h.render().find(node=>node.type==='select').props.onChange({target:{value:'template'}});
 let tree=h.render();assert.ok(JSON.stringify(tree).includes('aiLibrary.used{\\"count\\":2}'));assert.equal(h.button('common.delete').props.disabled,true);
 tree.find(node=>node.type==='textarea').props.onChange({target:{value:'UPDATED'}});h.render();assert.equal(promptState.settings.aiPromptTemplates[0].prompt,'ORIGINAL');
 h.button('dialog.save').props.onClick();assert.equal(promptState.settings.aiPromptTemplates[0].prompt,'UPDATED');
 promptState.settings.chatFolders=[];assert.equal(h.button('common.delete').props.disabled,false);h.button('common.delete').props.onClick();assert.equal(promptState.settings.aiPromptTemplates.length,0);
});

test('copying a template creates a separate entry and leaves existing folder references intact',()=>{
 const h=fixture();h.render().find(node=>node.type==='select').props.onChange({target:{value:'template'}});h.button('aiLibrary.copy').props.onClick();h.render();h.button('dialog.save').props.onClick();
 assert.equal(promptState.settings.aiPromptTemplates.length,2);assert.notEqual(promptState.settings.aiPromptTemplates[1].id,'template');assert.equal(promptState.settings.chatFolders[0].aiPromptTemplateId,'template');
});
