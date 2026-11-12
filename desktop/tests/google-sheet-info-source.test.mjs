import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const mocks={
 react:'export const useState=value=>globalThis.infoHooks.state(value);export const useEffect=()=>{};',
 'react/jsx-runtime':'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";',
 '@/i18n':'export const useI18n=()=>({t:key=>key});',
 '@/store/appStore':'export const useAppStore=f=>f(globalThis.infoState);',
 '@/lib/googleSheets':`export const useGoogleSheets=()=>globalThis.infoSheets;useGoogleSheets.getState=()=>globalThis.infoSheets;
 export const sheetConnections=(state=globalThis.infoSheets)=>state.entries;
 export const letter=i=>String.fromCharCode(65+i);export const tabRange=tab=>"'"+tab+"'";
 export const sheetHeaders=async()=>['Phone','Value'];export const readGoogleDoc=async()=>[];
 export const readSheet=async id=>({valueRanges:[{values:[['+12025550100']]},{values:[[id==='book-b'?'from B':'from A']]}]});
 export const updateSheetCell=async(...args)=>globalThis.infoWrites.push(args);export const refreshSheets=async(...args)=>globalThis.infoRefreshes.push(args);`,
};
const built=await build({entryPoints:[root+'src/components/crm/GoogleSheetInfo.tsx'],bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',alias:{'@':root+'src'},plugins:[{name:'sheet-info-boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {GoogleSheetInfo}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree?.props?[tree,...nodes(tree.props.children)]:[];
function setup(t){
 const contact={id:'person',phone:'+12025550100'};
 const entry=(id,value)=>({id,name:id,config:{spreadsheet:'book-'+id,tab:'People',headerRow:1,phone:{heading:'Phone'},fields:[{id:'same-field',label:'Value',column:{heading:'Value'},action:'edit'}]},data:{'same-field':{at:1,columnIndex:1,values:{'+12025550100':[{value,row:2,links:[]}]}}},error:''});
 globalThis.infoSheets={email:'owner@example.com',busy:false,entries:[entry('a','from A'),entry('b','from B')]};
 globalThis.infoState={settings:{chatFolders:[{id:'folder',chatIds:['chat'],sheetConnectionId:'b'}]},chats:[{id:'chat',contactId:'person'}],selectedChatId:'chat'};
 globalThis.infoWrites=[];globalThis.infoRefreshes=[];
 let index=0,cells=[];globalThis.infoHooks={state(value){const n=index++;if(!(n in cells))cells[n]=value;return[cells[n],next=>cells[n]=typeof next==='function'?next(cells[n]):next];}};
 t.after(()=>{for(const key of ['infoSheets','infoState','infoWrites','infoRefreshes','infoHooks'])delete globalThis[key];});
 return {contact,render(){index=0;return nodes(GoogleSheetInfo({contact,chatId:'chat',expanded:true}));},child(node){cells=[];return()=>{index=0;return nodes(node.type(node.props));};}};
}
test('the sidebar displays and writes only the linked sheet, even with shared field IDs and phone numbers',async t=>{
 const h=setup(t),tree=h.render(),value=tree.find(node=>typeof node.type==='function'&&node.props.cell);
 assert.equal(value.props.cell.value,'from B');assert.equal(value.props.connectionId,'b');
 const renderChild=h.child(value);let controls=renderChild();controls.find(node=>node.type==='textarea').props.onChange({target:{value:'Updated B'}});controls=renderChild();
 await controls.find(node=>node.type==='button').props.onClick();
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(infoWrites,[['book-b','People',1,2,'Updated B']]);assert.deepEqual(infoRefreshes,[[true,'b']]);
 assert.equal(infoSheets.entries[0].data['same-field'].values['+12025550100'][0].value,'from A');
});
test('conflicting folder associations require an explicit source and a deleted binding never falls back',t=>{
 const h=setup(t);infoState.settings.chatFolders.push({id:'other',chatIds:['chat'],sheetConnectionId:'a'});
 let tree=h.render();assert.equal(tree.some(node=>node.props.cell),false);
 tree.find(node=>node.type==='select').props.onChange({target:{value:'a'}});tree=h.render();assert.equal(tree.find(node=>node.props.cell)?.props.cell.value,'from A');
 infoState.settings.chatFolders=[{id:'folder',chatIds:['chat'],sheetConnectionId:'deleted'}];tree=h.render();
 assert.equal(tree.some(node=>node.props.cell),false);assert.ok(tree.some(node=>node.props.children==='sheets.missing'));
});
