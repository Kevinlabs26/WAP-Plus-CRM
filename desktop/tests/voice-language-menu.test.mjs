import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';
import { VOICE_INPUT_LANGUAGES } from '../src/lib/voiceInputLanguage.ts';
const source=readFileSync(new URL('../src/components/chat/Composer.tsx',import.meta.url),'utf8');
const start=source.indexOf('            <div ref={voiceLanguageRef}');
const end=source.indexOf('            </div>\n          </div>\n        </div>\n\n        <TranslateBar',start)+'            </div>'.length;
assert.ok(start>=0&&end>start);
const code=await transform(`function render(scope){const {element,voiceLanguageRef,voiceLanguageMenuRef,t,voiceInputOpen,voiceInputBusy,recording,sending,inputLocked,setVoiceLanguageOpen,handleCancelVoiceInput,handleToggleVoiceInput,cn,Loader2,Captions,settings,VOICE_INPUT_LANGUAGES,createPortal,window,document,useAppStore,voiceLanguageOpen}=scope;return (${source.slice(start,end)});}`,{loader:'tsx',jsxFactory:'element'});
const render=new Function(code.code+';return render;')();
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t?.props?[t,...nodes(t.props.children)]:[];
function fixture(){let open=false;const writes=[],body={};const scope={element:(type,props,...children)=>({type,props:{...props,children}}),voiceLanguageRef:{current:{getBoundingClientRect:()=>({right:900,top:650})}},voiceLanguageMenuRef:{current:null},t:k=>k,voiceInputOpen:false,voiceInputBusy:false,recording:false,sending:false,inputLocked:false,setVoiceLanguageOpen:v=>{open=typeof v==='function'?v(open):v;},handleCancelVoiceInput(){},handleToggleVoiceInput(){},cn:()=>'',Loader2:'loader',Captions:'captions',settings:{voiceInputLang:'fr'},VOICE_INPUT_LANGUAGES,createPortal:(tree,target)=>{assert.equal(target,body);return tree;},window:{innerWidth:1000,innerHeight:800},document:{body},useAppStore:{getState:()=>({updateSettings:v=>writes.push(v)})}};return{scope,writes,get open(){return open;},render(){return render({...scope,voiceLanguageOpen:open});}};}
test('right click and language badge open a portal selector and selection is saved',()=>{
 const ui=fixture();let tree=ui.render();nodes(tree).find(n=>n.props.onContextMenu).props.onContextMenu({preventDefault(){},stopPropagation(){}});assert.equal(ui.open,true);
 tree=ui.render();const menu=nodes(tree).find(n=>n.props.id==='voice-input-language-menu');assert.ok(menu);assert.match(menu.props.className,/fixed/);assert.equal(menu.props.style.bottom,158);
 const buttons=nodes(menu).filter(n=>n.type==='button');assert.equal(buttons.length,VOICE_INPUT_LANGUAGES.length);assert.equal(buttons.find(n=>n.props.key==='fr').props['aria-pressed'],true);
 buttons.find(n=>n.props.key==='zh').props.onClick();assert.deepEqual(ui.writes,[{voiceInputLang:'zh'}]);assert.equal(ui.open,false);
 nodes(ui.render()).find(n=>n.props['aria-controls']==='voice-input-language-menu').props.onClick();assert.equal(ui.open,true);
});
test('language cannot be changed during active speech recognition',()=>{
 const ui=fixture();ui.scope.voiceInputOpen=true;const tree=ui.render();assert.equal(nodes(tree).find(n=>n.props['aria-controls']).props.disabled,true);nodes(tree).find(n=>n.props.onContextMenu).props.onContextMenu({preventDefault(){},stopPropagation(){}});assert.equal(ui.open,false);
});
