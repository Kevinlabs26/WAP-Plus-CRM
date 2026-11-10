export type AiUsageFeature = "suggestion" | "autoReply" | "outreach" | "translation" | "insight" | "transcription" | "context" | "image";
export type AiUsageContext = {provider:string;model:string;feature:AiUsageFeature;endpoint?:string};
import {officialAiPriceInfo,officialAiUsageRate} from "./aiPricing.ts";
export type AiTokenUsage = {input:number;output:number;cached:number;total:number;cost?:number;cacheWrite?:number;billingTier?:string};
export type AiUsageBucket = {day:string;provider:string;model:string;service:string;feature:AiUsageFeature;requests:number;failed:number;unknown:number;input:number;output:number;cached:number;total:number;reportedCost:number;reportedRequests:number;unpricedInput:number;unpricedOutput:number;unpricedCached:number;unpricedCacheWrite?:number;longContext?:boolean;billingTier?:string};
export type AiUsageRate = {input:number;output:number;cached?:number;cacheWrite?:number};
type UsageData = {buckets:AiUsageBucket[];rates:Record<string,AiUsageRate>;since:string;error:boolean;limited:boolean};
const KEY="wap-plus-ai-usage-v1",features=["suggestion","autoReply","outreach","translation","insight","transcription","context","image"];
const listeners=new Set<()=>void>();
let loaded=false,snapshot:UsageData={buckets:[],rates:{},since:new Date().toISOString(),error:false,limited:false};
const number=(value:unknown)=>typeof value==="number"&&Number.isFinite(value)&&value>=0&&value<=1e12;
const count=(value:unknown)=>number(value)&&Number.isSafeInteger(value);
export const usageDay=(at=new Date())=>`${at.getFullYear()}-${String(at.getMonth()+1).padStart(2,"0")}-${String(at.getDate()).padStart(2,"0")}`;
export function usageService(provider:string,endpoint="") {
  // Custom endpoints may contain credentials; retain a grouping fingerprint only.
  let hash=2166136261;for(const char of endpoint.replace(/\/+$/, "")){hash=Math.imul(hash^char.charCodeAt(0),16777619);}
  return `${provider}:${(hash>>>0).toString(16)}`;
}
export const usageRateKey=(row:Pick<AiUsageBucket,"service"|"model">)=>JSON.stringify([row.service,row.model]);
function readStored():UsageData {
  if(typeof localStorage==="undefined")return snapshot;
  const raw=localStorage.getItem(KEY);if(!raw)return {...snapshot,buckets:[],rates:{}};
  if(raw.length>3_000_000)throw Error("Usage data too large");
  const data=JSON.parse(raw),rates:Record<string,AiUsageRate>={};
  if(!data||!Array.isArray(data.buckets)||data.buckets.length>6000)throw Error("Invalid usage data");
  const fields=["requests","failed","unknown","input","output","cached","total","reportedRequests","unpricedInput","unpricedOutput","unpricedCached"] as const;
  const buckets=data.buckets.filter((row:AiUsageBucket)=>row&&/^\d{4}-\d{2}-\d{2}$/.test(row.day)&&typeof row.provider==="string"&&row.provider.length<=40&&typeof row.model==="string"&&row.model.length<=160&&typeof row.service==="string"&&row.service.length<=70&&features.includes(row.feature)&&fields.every(key=>count(row[key]))&&number(row.reportedCost)&&row.cached<=row.input&&row.unknown<=row.requests&&row.reportedRequests<=row.requests);
  if(buckets.length!==data.buckets.length)throw Error("Invalid usage records");
  if(buckets.some((row:AiUsageBucket)=>row.unpricedCached>row.unpricedInput||row.unpricedInput>row.input||row.unpricedOutput>row.output||row.unknown+row.reportedRequests>row.requests||row.unpricedCacheWrite!==undefined&&(!count(row.unpricedCacheWrite)||row.unpricedCacheWrite>row.unpricedInput-row.unpricedCached)||row.longContext!==undefined&&typeof row.longContext!=="boolean"||row.billingTier!==undefined&&(typeof row.billingTier!=="string"||row.billingTier.length>40)))throw Error("Invalid usage pricing context");
  for(const [key,value] of Object.entries(data.rates||{}).slice(0,200))if(key.length<=250&&value&&typeof value==="object"){
    const rate=value as AiUsageRate;if(number(rate.input)&&number(rate.output)&&(rate.cached===undefined||number(rate.cached))&&(rate.cacheWrite===undefined||number(rate.cacheWrite)))rates[key]=rate;
  }
  return {buckets,rates,since:typeof data.since==="string"&&Number.isFinite(Date.parse(data.since))?data.since:snapshot.since,error:false,limited:data.limited===true};
}
function publish(data:UsageData){snapshot=data;for(const listener of listeners)listener();}
function load(){if(!loaded){loaded=true;try{snapshot=readStored();}catch{snapshot={...snapshot,error:true};}}}
export function getAiUsageSnapshot(){load();return snapshot;}
export function subscribeAiUsage(listener:()=>void){load();listeners.add(listener);return()=>{listeners.delete(listener);};}
if(typeof window!=="undefined")window.addEventListener("storage",event=>{if(event.key===KEY){try{publish(readStored());}catch{publish({...snapshot,error:true});}}});
async function commit(change:(data:UsageData)=>UsageData){
  load();
  const write=()=>{try{const next=change(readStored());if(typeof localStorage!=="undefined")localStorage.setItem(KEY,JSON.stringify(next));publish(next);}catch{publish({...snapshot,error:true});}};
  try{if(typeof navigator!=="undefined"&&navigator.locks)await navigator.locks.request(KEY,write);else write();}catch{publish({...snapshot,error:true});}
}
export async function saveAiUsageRate(key:string,rate:AiUsageRate){
  if(key.length>250||!number(rate.input)||!number(rate.output)||(rate.cached!==undefined&&!number(rate.cached))||(rate.cacheWrite!==undefined&&!number(rate.cacheWrite)))throw Error("Invalid model price");
  await commit(data=>({...data,rates:{...data.rates,[key]:rate}}));
}
export async function clearAiUsageRate(key:string){await commit(data=>{const rates={...data.rates};delete rates[key];return {...data,rates};});}
export function resolveAiUsageRate(row:AiUsageBucket,rates:Record<string,AiUsageRate>){return rates[usageRateKey(row)]||officialAiUsageRate(row);}
/** Provider totals are cumulative in streams; never add individual SSE usage chunks. */
export function parseAiTokenUsage(data:unknown,provider:string):AiTokenUsage|null {
  const raw=data as Record<string,any>|null;if(!raw||typeof raw!=="object")return null;
  const usage=raw.usageMetadata||raw.usage;
  let input:unknown,output:unknown,cached:unknown=0,total:unknown,cost:unknown;
  if(provider==="ollama"){input=raw.prompt_eval_count;output=raw.eval_count;}
  else if(raw.usageMetadata){input=usage.promptTokenCount;output=number(usage.candidatesTokenCount??usage.responseTokenCount)?(usage.candidatesTokenCount??usage.responseTokenCount)+(number(usage.thoughtsTokenCount)?usage.thoughtsTokenCount:0):undefined;cached=usage.cachedContentTokenCount??0;total=usage.totalTokenCount;}
  else if(usage){input=usage.prompt_tokens??usage.input_tokens;output=usage.completion_tokens??usage.output_tokens;cached=usage.prompt_tokens_details?.cached_tokens??usage.prompt_cache_hit_tokens??0;total=usage.total_tokens;if(provider==="openrouter")cost=usage.cost;}
  if(!count(input)||!count(output)||!count(cached)||Number(cached)>Number(input))return null;
  const cacheWrite=usage?.prompt_tokens_details?.cache_write_tokens??usage?.input_tokens_details?.cache_write_tokens??0;
  if(!count(cacheWrite)||Number(cached)+Number(cacheWrite)>Number(input))return null;
  const tier=raw.service_tier??usage?.trafficType;
  const sum=Number(input)+Number(output);return {input:Number(input),output:Number(output),cached:Number(cached),total:count(total)&&Number(total)>=sum?Number(total):sum,...(number(cost)?{cost:Number(cost)}:{}),...(cacheWrite?{cacheWrite:Number(cacheWrite)}:{}),...(typeof tier==="string"&&tier.length>0&&tier.length<=40?{billingTier:tier.toLowerCase()}:{})};
}
export async function trackAiRequest<T>(context:AiUsageContext,run:(observe:(data:unknown)=>void)=>Promise<T>):Promise<T>{
  let usage:AiTokenUsage|null=null,failed=true;
  const day=usageDay();
  try{const result=await run(data=>{usage=parseAiTokenUsage(data,context.provider)||usage;});failed=false;return result;}
  finally{
    const tokens=usage as AiTokenUsage|null;
    await commit(data=>{
      const cutoff=usageDay(new Date(Date.now()-400*86400_000)),buckets=data.buckets.filter(row=>row.day>=cutoff),service=usageService(context.provider,context.endpoint),model=context.model.slice(0,160);
      const threshold=officialAiPriceInfo(context.provider,model)?.threshold,longContext=threshold&&tokens?tokens.input>threshold:undefined,billingTier=tokens?.billingTier;
      const index=buckets.findIndex(row=>row.day===day&&row.service===service&&row.model===model&&row.feature===context.feature&&row.longContext===longContext&&row.billingTier===billingTier);
      const row:AiUsageBucket=index<0?{day,provider:context.provider.slice(0,40),model,service,feature:context.feature,requests:0,failed:0,unknown:0,input:0,output:0,cached:0,total:0,reportedCost:0,reportedRequests:0,unpricedInput:0,unpricedOutput:0,unpricedCached:0,longContext,...(billingTier?{billingTier}:{})}:{...buckets[index]};
      row.requests++;row.failed+=Number(failed);row.unknown+=Number(!tokens);
      if(tokens){row.input+=tokens.input;row.output+=tokens.output;row.cached+=tokens.cached;row.total+=tokens.total;if(tokens.cost!==undefined){row.reportedCost+=tokens.cost;row.reportedRequests++;}else{row.unpricedInput+=tokens.input;row.unpricedOutput+=tokens.output;row.unpricedCached+=tokens.cached;row.unpricedCacheWrite=(row.unpricedCacheWrite||0)+(tokens.cacheWrite||0);}}
      if(index<0)buckets.push(row);else buckets[index]=row;
      return {...data,buckets:buckets.slice(-6000),limited:data.limited||buckets.length>6000};
    });
  }
}
export function summarizeAiUsage(rows:readonly AiUsageBucket[],rates:Record<string,AiUsageRate>){
  return rows.reduce((sum,row)=>{
    sum.requests+=row.requests;sum.failed+=row.failed;sum.unknown+=row.unknown;sum.input+=row.input;sum.output+=row.output;sum.cached+=row.cached;sum.total+=row.total;sum.cost+=row.reportedCost;sum.priced+=row.reportedRequests;
    const rate=resolveAiUsageRate(row,rates),remaining=row.requests-row.unknown-row.reportedRequests,writes=row.unpricedCacheWrite||0;
    if(rate){sum.cost+=((row.unpricedInput-row.unpricedCached-writes)*rate.input+row.unpricedCached*(rate.cached??rate.input)+writes*(rate.cacheWrite??rate.input)+row.unpricedOutput*rate.output)/1_000_000;sum.priced+=remaining;}else sum.unpriced+=remaining;
    return sum;
  },{requests:0,failed:0,unknown:0,input:0,output:0,cached:0,total:0,cost:0,priced:0,unpriced:0});
}
