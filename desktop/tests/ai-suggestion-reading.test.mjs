import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {langShortLabel, TRANSLATE_LANGS} from '../src/lib/translateDraft.ts';

const mocks = {
  react: 'export const useEffect=(...args)=>globalThis.readingHooks.useEffect(...args);export const useState=(...args)=>globalThis.readingHooks.useState(...args);',
  'react/jsx-runtime': 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;',
  '@/i18n': 'export const useI18n=()=>({t:globalThis.readingTranslate});',
  '@/lib/translateDraft': 'export const TRANSLATE_LANGS=globalThis.readingLanguages;export const langShortLabel=code=>globalThis.readingLabel(code);export const translateDraftText=(...args)=>globalThis.readingService(...args);',
  'lucide-react': 'export const ChevronDown="icon";',
};
const built = await build({stdin:{contents:"export {AiSuggestionCard} from './src/components/crm/AiSuggestionCard.tsx';export {AiSuggestionReadingControl} from './src/components/crm/AiSuggestionReadingControl.tsx';",resolveDir:fileURLToPath(new URL('../',import.meta.url))},bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',plugins:[{name:'reading-boundaries',setup(b){
  b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);
  b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));
}}]});
globalThis.readingLanguages=TRANSLATE_LANGS;
globalThis.readingLabel=langShortLabel;
globalThis.readingTranslate=key=>key;
const {AiSuggestionCard,AiSuggestionReadingControl}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text+'\n//# sourceURL=ai-suggestion-reading.js').toString('base64'));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree?.props?[tree,...nodes(tree.props.children)]:[];
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture() {
  const slots=[],effects=[],requests=[],inserted=[];let cursor=0,tree;
  globalThis.readingHooks={
    useState(initial){const i=cursor++;slots[i]??={value:initial};return [slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value;}];},
    useEffect(fn,deps){const i=cursor++,old=slots[i];if(old&&deps.every((x,j)=>Object.is(x,old.deps[j])))return;
      slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});},
  };
  globalThis.readingService=(...args)=>new Promise((resolve,reject)=>requests.push({args,resolve,reject}));
  const props={text:'Bonjour, je vous enverrai les informations demain matin.',contextKey:'chat-a:account-a',settings:{aiProvider:'custom'},language:'',onInsert:mode=>inserted.push(mode)};
  const ui={props,requests,inserted,
    render(){for(let pass=0;pass<2;pass++){cursor=0;tree=AiSuggestionCard(props);effects.splice(0).forEach(fn=>fn());}return tree;},
    language(value){props.language=value;ui.render();},
    displayed(){return nodes(tree).find(n=>n.type==='p').props.children;},
    buttons(){return nodes(tree).filter(n=>n.type==='button');},
    unmount(){slots.forEach(slot=>slot?.cleanup?.());},
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

test('cards follow the shared reading language without changing the original or insert/append payload',async()=>{
  const f=fixture();assert.equal(f.requests.length,0,'no translation request before the user chooses a language');
  assert.equal(f.displayed(),f.props.text);
  assert.equal(nodes(f.render()).filter(n=>n.type==='select').length,0,'no per-card language controls');
  for(const language of TRANSLATE_LANGS){
    f.language(language.code);assert.equal(f.displayed(),f.props.text,'original remains readable while loading');
    const request=f.requests.at(-1);assert.deepEqual(request.args,[f.props.text,language.code,f.props.settings]);
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
  german.resolve({text:'Guten Morgen.',targetLang:'de'});await settle();f.render();
  old.resolve({text:'过期中文',targetLang:'zh'});await settle();f.render();assert.equal(f.displayed(),'Guten Morgen.');
  f.language('es');const oldText=f.requests.at(-1);
  f.props.text='Nouvelle suggestion.';f.render();assert.equal(f.displayed(),f.props.text);
  oldText.resolve({text:'OUTDATED TEXT',targetLang:'es'});await settle();f.render();assert.equal(f.displayed(),f.props.text);
  const oldContext=f.requests.at(-1);f.props.contextKey='chat-b:account-b';f.render();
  oldContext.resolve({text:'WRONG CUSTOMER',targetLang:'es'});await settle();f.render();assert.equal(f.displayed(),f.props.text);
  const newest=f.requests.at(-1);newest.resolve({text:'Buenos días.',targetLang:'es'});await settle();f.render();assert.equal(f.displayed(),'Buenos días.');
  f.language('pt');const unmounted=f.requests.at(-1);f.unmount();
  unmounted.reject(Error('late failure'));await settle();assert.equal(f.displayed(),f.props.text);
});

test('failed, empty and wrong-target translations preserve the original, show an error and allow retry',async()=>{
  for(const failure of [{fallback:true,error:'offline',text:'do not show',targetLang:'zh'},{text:'',targetLang:'zh'},{text:'wrong target',targetLang:'fr'},Error('service unavailable')]){
    const f=fixture();f.language('zh');const request=f.requests[0];
    if(failure instanceof Error)request.reject(failure);else request.resolve(failure);
    await settle();f.render();assert.equal(f.displayed(),f.props.text);assert.ok(nodes(f.render()).some(n=>n.props.role==='alert'));
    f.buttons().find(n=>n.props.children==='common.retry').props.onClick();f.render();assert.equal(f.requests.length,2);
    f.requests[1].resolve({text:'您好，明天早上给您发送资料。',targetLang:'zh'});await settle();f.render();
    assert.equal(f.displayed(),'您好，明天早上给您发送资料。');assert.ok(!nodes(f.render()).some(n=>n.props.role==='alert'));
    f.unmount();
  }
});
