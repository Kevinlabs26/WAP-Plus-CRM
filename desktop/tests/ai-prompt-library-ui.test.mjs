import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const mocks={react:'export const useState=initial=>globalThis.promptHooks(initial);export const useEffect=()=>{};export const useRef=initial=>useState(()=>({current:initial}))[0];','react/jsx-runtime':'export const Fragment="fragment";export const jsx=(type,props)=>({type,props});export const jsxs=jsx;',
 'lucide-react':'export const Check="check", ChevronDown="chevron-down", ChevronRight="chevron-right", Copy="copy", FileText="file", Folder="folder", FolderPlus="folder-plus", GripVertical="grip", Pencil="pencil", Trash2="trash", X="close";',
 '@/store/appStore':'export const useAppStore=selector=>selector(globalThis.promptState);useAppStore.getState=()=>globalThis.promptState;',
 '@/i18n':'export const useI18n=()=>({t:(key,params)=>key+(params?JSON.stringify(params):"")});','@/components/ui/primitives':'export const Button="button",Input="input",Textarea="textarea";'};
const built=await build({entryPoints:[root+'src/components/settings/AiPromptLibrary.tsx'],bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',alias:{'@':root+'src'},plugins:[{name:'library-ui',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {AiPromptLibrary}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text+'\n//# sourceURL=prompt-library-ui.js').toString('base64'));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree?.props?[tree,...nodes(tree.props.children)]:[];
function fixture(){let slots=[],cursor=0;globalThis.promptHooks=initial=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value];};
 globalThis.promptState={settings:{aiPromptTemplates:[{id:'template',name:'Shared',prompt:'ORIGINAL'}],chatFolders:[{id:'parent',name:'Parent',scope:{type:'account',accountId:'a'},chatIds:[],aiPromptTemplateId:'template'},{id:'child',name:'Child',parentId:'parent',scope:{type:'account',accountId:'a'},chatIds:[]}],aiSystemPrompt:'',aiSystemPromptByAccountId:{},activeAccountId:'a'},updateSettings(patch){this.settings={...this.settings,...patch};},pushToast(){}};
 const render=()=>{cursor=0;return nodes(AiPromptLibrary());};const button=label=>render().find(node=>node.type==='button'&&(node.props.children===label||node.props['aria-label']===label));
 return {render,button};}

test('dragging a prompt changes only its folder order and keeps the open draft', () => {
 const h = fixture();
 promptState.settings.aiPromptFolders = [{ id: 'visits', name: 'Visits' }, { id: 'other', name: 'Other' }];
 promptState.settings.aiPromptTemplates = [
   { id: 'template', name: 'Second', folderId: 'visits', prompt: 'Original' },
   { id: 'different', name: 'Other', folderId: 'other', prompt: 'Other' },
   { id: 'first', name: 'First', folderId: 'visits', prompt: 'First' },
 ];
 h.render().find(node => node.type === 'textarea').props.onChange({ target: { value: 'Unsaved draft' } });
 const row = id => h.render().find(node => node.props['data-prompt-template-row'] === id);
 const grip = id => nodes(row(id)).find(node => node.props.onPointerDown);
 let target = 'different';
 let captured = null;
 const currentTarget = { setPointerCapture(id) { captured = id; }, closest: () => ({ contains: () => true }) };
 const event = { pointerId: 7, button: 0, clientX: 5, clientY: 5, currentTarget };
 const originalDocument = globalThis.document;
 globalThis.document = { elementFromPoint: () => ({ closest: () => ({
   dataset: { promptTemplateRow: target }, getBoundingClientRect: () => ({ top: 0, height: 30 }),
 }) }) };
 try {
   grip('first').props.onPointerDown({ ...event, clientY: 90 });
   assert.equal(captured, 7);
   grip('first').props.onPointerUp(event);
   assert.equal(promptState.settings.aiPromptTemplates[0].id, 'template');
   target = 'template';
   grip('first').props.onPointerDown({ ...event, clientY: 90 });
   grip('first').props.onPointerMove(event);
   assert.match(row('template').props.className, /border-t-brand/);
   grip('first').props.onPointerUp(event);
 } finally { globalThis.document = originalDocument; }
 assert.deepEqual(promptState.settings.aiPromptTemplates.map(item => item.id), ['first', 'different', 'template']);
 assert.deepEqual(h.render().filter(node => node.props['data-prompt-template']).map(node => node.props['data-prompt-template']), ['first', 'template', 'different']);
 assert.equal(h.render().find(node => node.type === 'textarea').props.value, 'Unsaved draft');
 assert.equal(promptState.settings.chatFolders[0].aiPromptTemplateId, 'template');
 grip('first').props.onKeyDown({ key: 'ArrowDown', preventDefault() {} });
 assert.deepEqual(promptState.settings.aiPromptTemplates.map(item => item.id), ['template', 'different', 'first']);
});

test('a lone template can be dropped on an empty folder and then moved to unfiled', () => {
 const h = fixture();
 promptState.settings.aiPromptFolders = [{ id: 'source', name: 'Source' }, { id: 'destination', name: 'Destination' }];
 promptState.settings.aiPromptTemplates[0].folderId = 'source';
 h.render().find(node => node.type === 'textarea').props.onChange({ target: { value: 'Unsaved draft' } });
 const originalDocument = globalThis.document;
 let folderId = 'destination';
 globalThis.document = { elementFromPoint: () => ({ closest: () => ({ dataset: { promptFolderRow: folderId } }) }) };
 const currentTarget = { setPointerCapture() {}, closest: () => ({ contains: () => true }) };
 const event = { pointerId: 1, button: 0, clientX: 30, clientY: 50, currentTarget };
 const move = () => {
   const grip = h.render().find(node => node.props.onPointerDown);
   grip.props.onPointerDown({ ...event, clientX: 90 });
   grip.props.onPointerMove(event);
   assert.match(h.render().find(node => node.props['data-prompt-folder-row'] === folderId).props.className, /ring-brand/);
   grip.props.onPointerUp(event);
 };
 try {
   move();
   assert.equal(promptState.settings.aiPromptTemplates[0].folderId, 'destination');
   assert.equal(h.render().find(node => node.type === 'select').props.value, 'destination');
   folderId = '__unfiled_prompt_templates__';
   move();
   assert.equal(promptState.settings.aiPromptTemplates[0].folderId, undefined);
   assert.equal(h.render().find(node => node.type === 'textarea').props.value, 'Unsaved draft');
   assert.equal(promptState.settings.chatFolders[0].aiPromptTemplateId, 'template');
 } finally { globalThis.document = originalDocument; }
});

test('holding a template at the edge scrolls without pointer movement and updates its drop target', () => {
 const h = fixture();
 promptState.settings.aiPromptFolders = Array.from({ length: 90 }, (_, index) => ({ id: `folder-${index}`, name: `Folder ${index}` }));
 const original = { document: globalThis.document, requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame };
 const frames = new Map();
 let frame = 0;
 globalThis.requestAnimationFrame = callback => (frames.set(++frame, callback), frame);
 globalThis.cancelAnimationFrame = id => frames.delete(id);
 const tree = { scrollTop: 0, scrollHeight: 2700, clientHeight: 200, isConnected: true, contains: () => true, getBoundingClientRect: () => ({ left: 0, right: 300, top: 0, bottom: 200 }) };
 globalThis.document = { elementFromPoint: () => ({ closest: () => ({ dataset: { promptFolderRow: `folder-${Math.floor(tree.scrollTop / 30)}` } }) }) };
 const grip = h.render().find(node => node.props.onPointerDown);
 const event = { pointerId: 1, button: 0, clientX: 100, clientY: 196, currentTarget: { setPointerCapture() {}, closest: () => tree } };
 try {
   grip.props.onPointerDown({ ...event, clientY: 100 });
   grip.props.onPointerMove(event);
   for (let i = 0; i < 25; i++) {
     const [id, callback] = frames.entries().next().value;
     frames.delete(id);
     callback();
   }
   assert.equal(tree.scrollTop, 300);
   assert.match(h.render().find(node => node.props['data-prompt-folder-row'] === 'folder-10').props.className, /ring-brand/);
   grip.props.onPointerUp(event);
   assert.equal(promptState.settings.aiPromptTemplates[0].folderId, 'folder-10');
   assert.equal(frames.size, 0);
 } finally { Object.assign(globalThis, original); }
});

test('shared template editing shows inherited impact, commits only on save and protects referenced templates from deletion',()=>{
 const h=fixture();h.render().find(node=>node.props['data-prompt-template']==='template').props.onClick();
 let tree=h.render();assert.ok(JSON.stringify(tree).includes('aiLibrary.used{\\"count\\":2}'));assert.equal(h.button('common.delete').props.disabled,true);
 tree.find(node=>node.type==='textarea').props.onChange({target:{value:'UPDATED'}});h.render();assert.equal(promptState.settings.aiPromptTemplates[0].prompt,'ORIGINAL');
 h.button('dialog.save').props.onClick();assert.equal(promptState.settings.aiPromptTemplates[0].prompt,'UPDATED');
 promptState.settings.chatFolders=[];assert.equal(h.button('common.delete').props.disabled,false);h.button('common.delete').props.onClick();assert.equal(promptState.settings.aiPromptTemplates.length,0);
});

test('copying a template creates a separate entry and leaves existing folder references intact',()=>{
 const h=fixture();h.render().find(node=>node.props['data-prompt-template']==='template').props.onClick();h.button('aiLibrary.copy').props.onClick();h.render();h.button('aiLibrary.createAndSave').props.onClick();
 assert.equal(promptState.settings.aiPromptTemplates.length,2);assert.notEqual(promptState.settings.aiPromptTemplates[1].id,'template');assert.equal(promptState.settings.chatFolders[0].aiPromptTemplateId,'template');
});

test('new drafts have a create action, and switching templates only discards edits after confirmation', async () => {
 const h = fixture();
 const select = id => h.render().find(node => node.props['data-prompt-template'] === id).props.onClick();
 const fill = (type, value) => h.render().find(node => node.type === type && (type === "textarea" || node.props.maxLength)).props.onChange({ target: { value } });
 const prompt = () => h.render().find(node => node.type === 'textarea').props.value;
 await h.button('aiLibrary.new').props.onClick();
 fill('input', ' Draft ');
 const longPrompt = 'Instruction. '.repeat(2600).trim();
 fill('textarea', longPrompt);
 assert.ok(h.button('aiLibrary.new'));
 let confirmations = 0;
 promptState.requestConfirm = async () => { confirmations++; return false; };
 select('template');
 await Promise.resolve();
 assert.equal(confirmations, 1);
 assert.equal(prompt(), longPrompt);
 h.button('aiLibrary.createAndSave').props.onClick();
 assert.equal(promptState.settings.aiPromptTemplates.at(-1).prompt, longPrompt);
 assert.equal(h.render().filter(node => node.props['data-prompt-template']).length, 2);
 assert.equal(h.render().some(node => node.props.role === 'status'), false);
 fill('textarea', 'Edited draft');
 h.button('aiLibrary.new').props.onClick();
 await Promise.resolve();
 assert.equal(prompt(), 'Edited draft');
 promptState.requestConfirm = async () => true;
 h.button('aiLibrary.new').props.onClick();
 await Promise.resolve();
 assert.equal(prompt(), '');
});
