import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {getTranslationContextKey, langShortLabel, TRANSLATE_LANGS} from '../src/lib/translateDraft.ts';

const mocks = {
  react: 'export const useEffect=(...args)=>globalThis.readingHooks.useEffect(...args);export const useState=(...args)=>globalThis.readingHooks.useState(...args);export const useRef=(...args)=>globalThis.readingHooks.useRef(...args);',
  'react/jsx-runtime': 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;',
  '@/i18n': 'export const useI18n=()=>({t:globalThis.readingTranslate});',
  '@/lib/translateDraft': 'export const getTranslationContextKey=(...args)=>globalThis.readingKey(...args);export const TRANSLATE_LANGS=globalThis.readingLanguages;export const langShortLabel=code=>globalThis.readingLabel(code);export const translateDraftText=(...args)=>globalThis.readingService(...args);',
  'lucide-react': 'export const ChevronDown="icon";',
};
const built = await build({stdin:{contents:"export {AiSuggestionCard} from './src/components/crm/AiSuggestionCard.tsx';export {AiSuggestionReadingControl} from './src/components/crm/AiSuggestionReadingControl.tsx';",resolveDir:fileURLToPath(new URL('../',import.meta.url))},bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',plugins:[{name:'reading-boundaries',setup(b){
  b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);
  b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));
}}]});
globalThis.readingLanguages=TRANSLATE_LANGS;
globalThis.readingKey=getTranslationContextKey;
globalThis.readingLabel=langShortLabel;
globalThis.readingTranslate=key=>key;
const {AiSuggestionCard,AiSuggestionReadingControl}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text+'\n//# sourceURL=ai-suggestion-reading.js').toString('base64'));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree?.props?[tree,...nodes(tree.props.children)]:[];
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture() {
  const slots=[],effects=[],requests=[],inserted=[],payloads=[],timers=new Map();let cursor=0,tree,timerId=0;
  const oldWindow=globalThis.window;
  globalThis.window={setTimeout(fn,delay){assert.equal(delay,120);timers.set(++timerId,fn);return timerId;},clearTimeout(id){timers.delete(id);}};
  globalThis.readingHooks={
    useState(initial){const i=cursor++;slots[i]??={value:initial};return [slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value;}];},
    useRef(initial){return slots[cursor++]??={current:initial};},
    useEffect(fn,deps){const i=cursor++,old=slots[i];if(old&&deps.every((x,j)=>Object.is(x,old.deps[j])))return;
      slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});},
  };
  globalThis.readingService=(...args)=>new Promise((resolve,reject)=>requests.push({args,resolve,reject}));
  const props={text:'Bonjour, je vous enverrai les informations demain matin.',contextKey:'chat-a:account-a',settings:{aiProvider:'custom',customAiKey:'test',customAiBaseUrl:'https://example.invalid/v1',customAiModel:'model-a',translateService:'ai'},language:'',onInsert:(mode,text)=>{inserted.push(mode);payloads.push(text);}};
  const ui={props,requests,inserted,payloads,
    render(runTimers=true){for(let pass=0;pass<2;pass++){cursor=0;tree=AiSuggestionCard(props);effects.splice(0).forEach(fn=>fn());if(runTimers)ui.flushTimers();}return tree;},
    flushTimers(){const pending=[...timers.values()];timers.clear();pending.forEach(fn=>fn());},
    language(value,runTimers=true){props.language=value;ui.render(runTimers);},
    displayed(){const editor=nodes(tree).find(n=>n.type==='textarea');return editor?editor.props.value:nodes(tree).find(n=>n.type==='p').props.children;},
    buttons(){return nodes(tree).filter(n=>n.type==='button');},
    unmount(){slots.forEach(slot=>slot?.cleanup?.());globalThis.window=oldWindow;},
  };ui.render();return ui;
}

test('one shared control toggles original/translation in one click and remembers the chosen supported language',()=>{
  const changed=[],props={language:'',targetLanguage:'zh',onChange:language=>{changed.push(language);props.language=language;if(language)props.targetLanguage=language;}};
  const render=()=>nodes(AiSuggestionReadingControl(props));
  assert.deepEqual(render().filter(n=>n.type==='option').map(n=>n.props.value),TRANSLATE_LANGS.map(l=>l.code));
  let buttons=render().filter(n=>n.type==='button');assert.equal(buttons[0].props['aria-pressed'],true);
  assert.equal(buttons[1].props.children,'中文');buttons[1].props.onClick();assert.equal(props.language,'zh');
  buttons=render().filter(n=>n.type==='button');assert.equal(buttons[1].props['aria-pressed'],true);
  buttons[0].props.onClick();assert.equal(props.language,'');assert.equal(props.targetLanguage,'zh');
  buttons[1].props.onClick();assert.equal(props.language,'zh');
  for(const language of TRANSLATE_LANGS){render().find(n=>n.type==='select').props.onChange({target:{value:language.code}});assert.equal(props.language,language.code);}
  const count=changed.length;render().find(n=>n.type==='select').props.onChange({target:{value:'unsupported'}});assert.equal(changed.length,count);
});

test('editing changes the inserted original, translates only on demand and cannot carry edits into a new context',async()=>{
 const f=fixture();nodes(f.render()).find(node=>node.type==='textarea').props.onChange({target:{value:'Texte corrigé.'}});f.render();
 f.buttons()[0].props.onClick();assert.equal(f.payloads.at(-1),'Texte corrigé.');assert.equal(f.requests.length,0);
 f.language('zh');assert.equal(f.requests[0].args[0],'Texte corrigé.');f.requests[0].resolve({text:'修订后的译文',targetLang:'zh'});await settle();f.render();
 f.buttons()[0].props.onClick();assert.equal(f.payloads.at(-1),'Texte corrigé.');
 f.buttons().find(node=>node.props.children==='crmPanel.editOriginal').props.onClick();f.render();
 nodes(f.render()).find(node=>node.type==='textarea').props.onChange({target:{value:'Autre texte.'}});f.render();assert.equal(f.requests.length,1,'editing never translates each keystroke');
 f.buttons().find(node=>node.props.children==='crmPanel.viewTranslation').props.onClick();f.render();assert.equal(f.requests[1].args[0],'Autre texte.');
 f.props.contextKey='another-chat';f.language('');assert.equal(f.displayed(),f.props.text);f.unmount();f.requests[1].resolve({text:'旧译文',targetLang:'zh'});await settle();
});

test('cards follow the shared reading language without changing the original or insert/append payload',async()=>{
  const f=fixture();assert.equal(f.requests.length,0,'no translation request before the user chooses a language');
  assert.equal(f.displayed(),f.props.text);
  assert.equal(nodes(f.render()).filter(n=>n.type==='select').length,0,'no per-card language controls');
  for(const language of TRANSLATE_LANGS){
    f.language(language.code);assert.equal(f.displayed(),f.props.text,'original remains readable while loading');
    const request=f.requests.at(-1);assert.deepEqual(request.args.slice(0,3),[f.props.text,language.code,f.props.settings]);
    assert.equal(request.args[3].googleFirst,true);assert.equal(request.args[3].signal.aborted,false);
    request.resolve({text:`Translation ${language.code}`,targetLang:language.code,fallback:false});await settle();f.render();
    assert.equal(f.displayed(),`Translation ${language.code}`);
    const buttons=f.buttons();assert.equal(buttons[0].props.children,'crmPanel.fillOriginal');assert.equal(buttons[1].props.children,'crmPanel.appendOriginal');
    buttons[0].props.onClick();buttons[1].props.onClick();
  }
  assert.deepEqual(f.inserted,TRANSLATE_LANGS.flatMap(()=>['replace','append']),'card only emits intent, never translated text');
  assert.match(f.props.text,/^Bonjour/);
  const count=f.requests.length;f.language('');assert.equal(f.displayed(),f.props.text);assert.equal(f.requests.length,count);
  f.unmount();
});

test('late translations cannot overwrite another language, revised suggestion, chat/account context or unmounted card',async()=>{
  const f=fixture();f.language('zh');const old=f.requests.at(-1);
  f.language('de');const german=f.requests.at(-1);
  assert.equal(old.args[3].signal.aborted,true,'obsolete language requests are aborted');
  german.resolve({text:'Guten Morgen.',targetLang:'de'});await settle();f.render();
  old.resolve({text:'过期中文',targetLang:'zh'});await settle();f.render();assert.equal(f.displayed(),'Guten Morgen.');
  f.language('es');const oldText=f.requests.at(-1);
  f.props.text='Nouvelle suggestion.';f.render();assert.equal(f.displayed(),f.props.text);
  assert.equal(oldText.args[3].signal.aborted,true);
  oldText.resolve({text:'OUTDATED TEXT',targetLang:'es'});await settle();f.render();assert.equal(f.displayed(),f.props.text);
  const oldContext=f.requests.at(-1);f.props.contextKey='chat-b:account-b';f.render();
  assert.equal(oldContext.args[3].signal.aborted,true);
  oldContext.resolve({text:'WRONG CUSTOMER',targetLang:'es'});await settle();f.render();assert.equal(f.displayed(),f.props.text);
  const newest=f.requests.at(-1);newest.resolve({text:'Buenos días.',targetLang:'es'});await settle();f.render();assert.equal(f.displayed(),'Buenos días.');
  f.language('pt');const unmounted=f.requests.at(-1);f.unmount();
  assert.equal(unmounted.args[3].signal.aborted,true);
  unmounted.reject(Error('late failure'));await settle();assert.equal(f.displayed(),f.props.text);
});

test('visited languages display synchronously without a loading flash or another request; only translation configuration invalidates them',async()=>{
  const f=fixture();f.language('zh');f.requests[0].resolve({text:'您好，明天早上给您发送资料。',targetLang:'zh'});await settle();f.render();
  f.language('de');f.requests[1].resolve({text:'Guten Morgen.',targetLang:'de'});await settle();f.render();
  f.language('');f.language('zh',false);
  assert.equal(f.displayed(),'您好，明天早上给您发送资料。','cached text is available in the same render');
  assert.ok(!nodes(f.render(false)).some(n=>n.props.role==='status'));f.flushTimers();assert.equal(f.requests.length,2);
  f.language('de',false);assert.equal(f.displayed(),'Guten Morgen.');f.flushTimers();assert.equal(f.requests.length,2);
  f.props.settings={...f.props.settings,theme:'dark',uiLanguage:'fr',quickReplyRecentIds:['a']};f.render();
  assert.equal(f.displayed(),'Guten Morgen.');assert.equal(f.requests.length,2,'unrelated settings never clear the translation or repeat work');
  f.props.settings={...f.props.settings,customAiModel:'model-b'};f.render();assert.equal(f.displayed(),f.props.text);assert.equal(f.requests.length,3);
  f.requests[2].resolve({text:'Neue Übersetzung.',targetLang:'de'});await settle();f.render();assert.equal(f.displayed(),'Neue Übersetzung.');f.unmount();
});

test('rapid language changes request only the final choice, and unrelated updates do not cancel an in-flight translation',async()=>{
  const f=fixture();f.language('zh',false);f.language('de',false);f.language('es',false);assert.equal(f.requests.length,0);
  f.flushTimers();assert.equal(f.requests.length,1);assert.equal(f.requests[0].args[1],'es');
  f.props.settings={...f.props.settings,quickReplyRecentIds:['changed']};f.render();assert.equal(f.requests.length,1);
  f.requests[0].resolve({text:'Buenos días.',targetLang:'es'});await settle();f.render();assert.equal(f.displayed(),'Buenos días.');f.unmount();
});

test('failed, empty and wrong-target translations preserve the original, show an error and allow retry',async()=>{
  for(const failure of [{fallback:true,error:'offline',text:'do not show',targetLang:'zh'},{text:'',targetLang:'zh'},{text:'wrong target',targetLang:'fr'},Error('service unavailable')]){
    const f=fixture();f.language('zh');const request=f.requests[0];
    if(failure instanceof Error)request.reject(failure);else request.resolve(failure);
    await settle();f.render();assert.equal(f.displayed(),f.props.text);assert.ok(nodes(f.render()).some(n=>n.props.role==='alert'));
    f.buttons().find(n=>n.props.children==='common.retry').props.onClick();f.render();assert.equal(f.requests.length,2);
    assert.ok(nodes(f.render()).some(n=>n.props.role==='status'),'retry visibly returns to loading');
    f.requests[1].resolve({text:'您好，明天早上给您发送资料。',targetLang:'zh'});await settle();f.render();
    assert.equal(f.displayed(),'您好，明天早上给您发送资料。');assert.ok(!nodes(f.render()).some(n=>n.props.role==='alert'));
    f.unmount();
  }
});
