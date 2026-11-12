import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { sheetInternationalPhone } from '../src/lib/googleSheetMatch.ts';
const root = fileURLToPath(new URL('../', import.meta.url));
const built = await build({entryPoints:[root+'src/lib/googleSheets.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'mock-boundaries',setup(build){
  build.onLoad({filter:/src[\\/]lib[\\/]bridge\.ts$/},()=>({contents:'export const isTauri=()=>true;',loader:'ts'}));
  build.onLoad({filter:/src[\\/]lib[\\/]idb\.ts$/},()=>({contents:'export const idbGet=async()=>globalThis.sheetStored;export const idbSet=async(key,value)=>{if(globalThis.sheetDiskFailure)throw new Error("disk full");globalThis.sheetStored=structuredClone(value)};export const idbDel=async()=>{globalThis.sheetStored=undefined;};',loader:'ts'}));
  build.onResolve({filter:/^@tauri-apps\/api\/core$/},()=>({path:'invoke',namespace:'mock'}));
  build.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const invoke=(...args)=>globalThis.sheetInvoke(...args);',loader:'js'}));
}}]});
const {initializeSheets, saveSheetConfig, refreshSheets, refreshAllSheets, removeSheetConnection, sheetConnections, useGoogleSheets} = await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));

test('bare legacy Benin numbers index the same contact and show multiple selected columns',async()=>{
 const headers=['Numéro','Nom','Profession'];
 const columns=[['Numéro','22957576439','+229 57 57 64 39','+2290157576439','22957576438','12025550100@lid'],['Nom','Beniegraceshop','Duplicate historical','Modern','Other','LID'],['Profession','商人','Second row','Modern job','Other job','Not a phone']];
 globalThis.sheetInvoke=async(_command,args)=>({valueRanges:args.ranges.length===1?[{values:headers.map(h=>[h])}]:[...columns.map(values=>({values:[values]})),{values:headers.map(h=>[h])}]});
 useGoogleSheets.setState({configured:true,email:'test@example.com'});
 try{
  await saveSheetConfig({spreadsheet:'legacy-benin',tab:'Contacts',headerRow:1,phone:{heading:'Numéro'},fields:[{id:'name',label:'姓名',column:{heading:'Nom'},schedule:{kind:'manual'}},{id:'job',label:'职业',column:{heading:'Profession'},schedule:{kind:'manual'}}]});
  const key=sheetInternationalPhone('22957576439'),state=useGoogleSheets.getState();assert.equal(state.error,'');
  assert.deepEqual(state.data.name.values[key],['Beniegraceshop','Duplicate historical']);assert.deepEqual(state.data.job.values[key],['商人','Second row']);
  assert.deepEqual(state.data.name.values['+2290157576439'],['Modern']);assert.equal(Object.keys(state.data.name.values).some(key=>key.includes('@lid')),false);
 }finally{delete globalThis.sheetInvoke;}
});

test('reads selected fields with current phone rows, keeps duplicates and retains good data on mapping failure', async()=>{
  let calls=[];
  let phone=['Phone','  +12025550100  ','+12025550100'];
  let order=['Order','first','second'];
  let headers=['Phone','Order','','Private'];
  globalThis.sheetInvoke=async(command,args)=>{
    if(command==='google_sheets_status')return {configured:true,email:'test@example.com'};
    assert.equal(command,'google_sheets_read');
    calls.push(args.ranges);
    const values=args.ranges.length===1 ? [headers.map(h=>[h])] : [[phone],[order],headers.map(h=>h?[h]:[])];
    return {valueRanges:values.map(values=>({values}))};
  };
  await initializeSheets();
  await saveSheetConfig({spreadsheet:'abc',tab:'Customers',headerRow:1,phone:{heading:'Phone'},fields:[{id:'order',label:'Order',column:{heading:'Order'},schedule:{kind:'interval',minutes:15}}]});
  assert.deepEqual(useGoogleSheets.getState().data.order.values['+12025550100'],['first','second']);
  assert.deepEqual(calls[1],["'Customers'!A:A","'Customers'!B:B","'Customers'!1:1"]);
  phone=['Phone','+33612345678','+12025550100'];order=['Order','other','updated'];
  await refreshSheets(true);
  assert.deepEqual(useGoogleSheets.getState().data.order.values['+12025550100'],['updated']);
  const successful=useGoogleSheets.getState().data;
  headers=['Phone','Renamed','Private'];await refreshSheets(true);
  assert.equal(useGoogleSheets.getState().data,successful);
  assert.match(useGoogleSheets.getState().error,/headings changed/);
  globalThis.sheetInvoke=async()=>{throw new Error('offline');};
  const config=useGoogleSheets.getState().config;
  await saveSheetConfig({...config,fields:config.fields.map(field=>({...field,label:'Renamed label',schedule:{kind:'interval',minutes:30}}))});
  assert.equal(useGoogleSheets.getState().data.order,successful.order);
  assert.match(useGoogleSheets.getState().error,/offline/);
  const committed=useGoogleSheets.getState().config;
  globalThis.sheetDiskFailure=true;
  await assert.rejects(saveSheetConfig({...committed,tab:'Another tab'}),/disk full/);
  assert.equal(useGoogleSheets.getState().config,committed);
  assert.equal(useGoogleSheets.getState().data.order,successful.order);
  delete globalThis.sheetDiskFailure;
  await saveSheetConfig({...committed,tab:'Another tab'});
  assert.deepEqual(useGoogleSheets.getState().data,{});
  delete globalThis.sheetInvoke;
});

test('oversized display-column selection is rejected before changing a working connection', async()=>{
 const previous=useGoogleSheets.getState();
 const fields=Array.from({length:99},(_,index)=>({id:String(index),label:String(index),column:{position:index},schedule:{kind:'manual'}}));
 await assert.rejects(saveSheetConfig({...previous.config,fields}),/maximum 98/);
 assert.equal(useGoogleSheets.getState().config,previous.config);
 assert.equal(useGoogleSheets.getState().data,previous.data);
 let count=0;
 globalThis.sheetInvoke=async(_command,args)=>{
  if(args.ranges.length===1)return {valueRanges:[{values:[['Phone'],['Order']]}]};
  count=args.ranges.length;
  return {valueRanges:args.ranges.map((_range,index)=>({values:index===args.ranges.length-1?[['Phone'],['Order']]:[[index===0?'Phone':'Order',index===0?'+12025550100':'value']]}))};
 };
 try {
  await saveSheetConfig({...previous.config,fields:fields.slice(0,98).map(field=>({...field,column:{position:1}}))});
  assert.equal(count,100);assert.equal(useGoogleSheets.getState().error,'');
 }finally{useGoogleSheets.setState(previous);delete globalThis.sheetInvoke;}
});

test('automatic retries wait longer after failures, pause on authorization errors and resume after success', async()=>{
 const originalNow=Date.now;let clock=1_800_000_000_000, calls=0;
 Date.now=()=>clock;
 useGoogleSheets.setState({failures:0,retryAt:null,pauseReason:null});
 globalThis.sheetInvoke=async()=>{calls++;throw new Error('offline');};
 try {
  await refreshSheets(true);assert.equal(calls,1);assert.equal(useGoogleSheets.getState().retryAt,clock+60_000);
  await refreshSheets();assert.equal(calls,1);
  clock+=60_000;await refreshSheets();assert.equal(calls,2);assert.equal(useGoogleSheets.getState().retryAt,clock+120_000);
  clock+=120_000;globalThis.sheetInvoke=async()=>{calls++;throw new Error('Google request failed (401)');};
  await refreshSheets();assert.equal(calls,3);assert.equal(useGoogleSheets.getState().pauseReason,'authorization');
  clock+=86_400_000;await refreshSheets();assert.equal(calls,3);
  await refreshSheets(true);assert.equal(calls,4,'manual retry remains available');
  useGoogleSheets.setState({failures:0,retryAt:null,pauseReason:null});
  globalThis.sheetInvoke=async()=>{throw new Error('Google request failed (429)');};
  await refreshSheets(true);assert.equal(useGoogleSheets.getState().retryAt,clock+300_000);
  globalThis.sheetInvoke=async(_command,args)=>({valueRanges:args.ranges.length===1?[{values:[['Phone'],['Order']]}]:[{values:[['Phone','+12025550100']]},{values:[['Order','ready']]},{values:[['Phone'],['Order']]}]});
  await refreshSheets(true);
  assert.equal(useGoogleSheets.getState().error,'');assert.equal(useGoogleSheets.getState().retryAt,null);assert.equal(useGoogleSheets.getState().failures,0);
 }finally{Date.now=originalNow;delete globalThis.sheetInvoke;}
});

const multiConfig=spreadsheet=>({spreadsheet,tab:'People',headerRow:1,phone:{heading:'Phone'},fields:[{id:'shared',label:'Value',column:{heading:'Value'},schedule:{kind:'manual'}}]});
const multiResponse=args=>({valueRanges:args.ranges.length===1?[{values:[['Phone'],['Value']]}]:[{values:[['Phone','+12025550100']]},{values:[['Value',args.spreadsheetId]]},{values:[['Phone'],['Value']]}]});
test('multiple named sheets keep identical field IDs and customer numbers isolated across refresh and reload',async()=>{
 globalThis.sheetInvoke=async(command,args)=>command==='google_sheets_status'?{configured:true,email:'test@example.com'}:multiResponse(args);
 try{
  await saveSheetConfig(multiConfig('source-a'),'default','Main table');
  await saveSheetConfig(multiConfig('source-b'),'sheet-b','Second table');
  assert.equal(useGoogleSheets.getState().data.shared.values['+12025550100'][0],'source-a');
  assert.equal(useGoogleSheets.getState().connections['sheet-b'].data.shared.values['+12025550100'][0],'source-b');
  assert.deepEqual(sheetConnections().map(item=>item.name),['Main table','Second table']);
  const fresh=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64')+'#reload-multiple');
  await fresh.initializeSheets();assert.equal(fresh.sheetConnections().length,2);
  assert.equal(fresh.useGoogleSheets.getState().connections['sheet-b'].data.shared.values['+12025550100'][0],'source-b');
  let release,entered;const firstRead=new Promise(resolve=>{entered=resolve;});
  globalThis.sheetInvoke=async(command,args)=>{if(args.spreadsheetId==='source-a'&&args.ranges.length===1){entered();await new Promise(resolve=>{release=resolve;});}return multiResponse(args);};
  const a=refreshSheets(true);await firstRead;const b=refreshSheets(true,'sheet-b');release();await Promise.all([a,b]);
  assert.equal(useGoogleSheets.getState().data.shared.values['+12025550100'][0],'source-a');
  assert.equal(useGoogleSheets.getState().connections['sheet-b'].data.shared.values['+12025550100'][0],'source-b');
  globalThis.sheetDiskFailure=true;await assert.rejects(removeSheetConnection('sheet-b'),/disk full/);assert.ok(useGoogleSheets.getState().connections['sheet-b']);delete globalThis.sheetDiskFailure;
  await removeSheetConnection('sheet-b');assert.equal(sheetConnections().length,1);assert.equal(useGoogleSheets.getState().config.spreadsheet,'source-a');
 }finally{delete globalThis.sheetInvoke;delete globalThis.sheetDiskFailure;}
});
test('a broken sheet does not block refreshing another sheet or replace its cache',async()=>{
 globalThis.sheetInvoke=async(command,args)=>multiResponse(args);
 try{
  await saveSheetConfig(multiConfig('source-b'),'sheet-b','Second table');
  globalThis.sheetInvoke=async(command,args)=>{if(args.spreadsheetId==='source-a')throw Error('offline');return multiResponse(args);};
  await Promise.all([refreshSheets(true),refreshSheets(true,'sheet-b')]);
  assert.match(useGoogleSheets.getState().error,/offline/);assert.equal(useGoogleSheets.getState().connections['sheet-b'].error,'');
  assert.equal(useGoogleSheets.getState().connections['sheet-b'].data.shared.values['+12025550100'][0],'source-b');
 }finally{delete globalThis.sheetInvoke;}
});
