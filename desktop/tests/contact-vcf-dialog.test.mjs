import assert from 'node:assert/strict';
import test from 'node:test';
import { build, transform } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { translate } from '../src/i18n/core.ts';
const mocks={
 react:'export const useState=v=>globalThis.vcfHooks.state(v);export const useRef=v=>globalThis.vcfHooks.ref(v);export const useMemo=f=>f();export const useEffect=(f,d)=>globalThis.vcfHooks.effect(f,d);',
 'react/jsx-runtime':'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";',
 'lucide-react':'export const ContactRound="icon",X="icon";',
 '@/components/ui/primitives':'export const Button="button",Input="input",Textarea="textarea";',
 '@/i18n':'export const useI18n=()=>({t:(k,p)=>globalThis.vcfTranslate(k,p)});',
};
const built=await build({entryPoints:[fileURLToPath(new URL('../src/components/chat/ContactVcfDialog.tsx',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',alias:{'@':fileURLToPath(new URL('../src',import.meta.url))},plugins:[{name:'vcf-ui',setup(b){
 b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {ContactVcfDialog}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t?.props?[t,...nodes(t.props.children)]:[];
const text=t=>Array.isArray(t)?t.map(text).join(''):t?.props?text(t.props.children):typeof t==='string'?t:'';
function fixture(){
 const oldDocument=globalThis.document;globalThis.document={activeElement:null};
 const cells=[],effects=[],files=[];let index=0,closed=0;
 globalThis.vcfHooks={state(v){const n=index++;cells[n]??={value:v};return[cells[n].value,v=>cells[n].value=v];},ref(v){return cells[index++]??={current:v};},effect(fn,deps){const n=index++;if(!cells[n]){cells[n]={};effects.push(()=>cells[n].cleanup=fn());}}};
 globalThis.vcfTranslate=(key,params)=>translate('zh-CN',key,params);
 const props={onClose:()=>closed++,onAttach:file=>files.push(file)};
 const ui={props,files,get closed(){return closed;},render(){index=0;const tree=ContactVcfDialog(props);while(effects.length)effects.shift()();return nodes(tree);},close(){cells.forEach(c=>c?.cleanup?.());globalThis.document=oldDocument;delete globalThis.vcfHooks;delete globalThis.vcfTranslate;}};
 return ui;
}
test('paste, name rules and preview produce a single UTF-8 attachment only after confirmation',async()=>{
 const ui=fixture();try{
  let tree=ui.render();tree.find(n=>n.type==='textarea').props.onChange({target:{value:'Jean Exemple\t12025550101\nNathalie Mère Exemple\t12025550102'}});
  tree=ui.render();let inputs=tree.filter(n=>n.type==='input'&&n.props.type!=='checkbox');
  inputs[0].props.onChange({target:{value:'10/30'}});inputs[1].props.onChange({target:{value:'Team'}});
  tree.find(n=>n.props.type==='checkbox').props.onChange({target:{checked:true}});tree=ui.render();
  assert.ok(text(tree).includes('10/30 Nathalie Mère Exemple Team 0102'));assert.deepEqual(ui.files,[]);
  const attach=tree.find(n=>n.type==='button'&&text(n)==='生成并添加附件');assert.equal(attach.props.disabled,false);attach.props.onClick();
  assert.equal(ui.files.length,1);assert.equal(ui.files[0].name,'contacts.vcf');assert.equal(ui.files[0].type,'text/vcard;charset=utf-8');
  const content=await ui.files[0].text();assert.equal((content.match(/BEGIN:VCARD/g)||[]).length,2);assert.match(content,/FN:10\/30 Jean Exemple Team 0101/);assert.equal(ui.closed,1);
 }finally{ui.close();}
});
test('invalid rows and unavailable attachment state block creation; escape dismisses without attaching',()=>{
 const ui=fixture();try{
  let tree=ui.render();tree.find(n=>n.type==='textarea').props.onChange({target:{value:'Invalid\t123'}});tree=ui.render();
  assert.ok(tree.some(n=>n.props.role==='alert'));assert.equal(tree.find(n=>n.type==='button'&&text(n)==='生成并添加附件').props.disabled,true);
  tree.find(n=>n.type==='textarea').props.onChange({target:{value:'Example\t12025550101'}});ui.props.disabled=true;tree=ui.render();
  assert.equal(tree.find(n=>n.type==='button'&&text(n)==='生成并添加附件').props.disabled,true);
  tree.find(n=>n.props.role==='dialog').props.onKeyDown({key:'Escape',preventDefault(){},stopPropagation(){}});assert.equal(ui.closed,1);assert.deepEqual(ui.files,[]);
 }finally{ui.close();}
});

test('composer VCF action stages a document in the existing attachment preview',async()=>{
 const source=readFileSync(new URL('../src/components/chat/Composer.tsx',import.meta.url),'utf8');
 const end=source.indexOf('</button>',source.indexOf('t("vcf.menu")'))+'</button>'.length;
 const start=source.lastIndexOf('<button',end-'</button>'.length);
 const modalStart=source.indexOf('{vcfOpen && createPortal('),modalEnd=source.indexOf('\n      {dragOver &&',modalStart);
 const markup=source.slice(modalStart+1,modalEnd).trim().slice(0,-1);
 const code=await transform(`function render(scope){const {element,Paperclip,t,sending,recording,inputLocked,mediaSendingIndex,pendingMedia,setAttachmentOpen,setVcfOpen,vcfOpen,createPortal,ContactVcfDialog,resetKey,sendAccountId,textareaRef,stageMedia,document}=scope;return [${source.slice(start,end)},${markup}];}`,{loader:'tsx',jsxFactory:'element'});
 const render=new Function(code.code+';return render;')();
 const staged=[];let open=false;
 const scope={element:(type,props,...children)=>({type,props:{...props,children}}),Paperclip:'icon',t:k=>k,sending:false,recording:false,inputLocked:false,mediaSendingIndex:-1,pendingMedia:[],setAttachmentOpen(){},setVcfOpen:v=>open=v,createPortal:node=>node,ContactVcfDialog:'dialog',resetKey:'chat-a',sendAccountId:'account-a',textareaRef:{current:null},stageMedia:(...args)=>staged.push(args),document:{body:{}}};
 render({...scope,vcfOpen:open})[0].props.onClick();assert.equal(open,true);
 const modal=render({...scope,vcfOpen:open})[1],file=new File(['BEGIN:VCARD'],'contacts.vcf');
 assert.equal(modal.props.key,'chat-a:account-a');modal.props.onAttach(file);assert.deepEqual(staged,[[[file],'file']]);
 modal.props.onClose();assert.equal(open,false);
 assert.equal(render({...scope,sending:true})[0].props.disabled,true);
 assert.equal(render({...scope,pendingMedia:Array(5).fill({})})[0].props.disabled,true);
});
