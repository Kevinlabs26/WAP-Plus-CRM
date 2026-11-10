import type {AiUsageBucket,AiUsageRate} from "./aiUsage.ts";

export const AI_PRICE_CHECKED_AT="2026-11-06";
export type OfficialAiRate=AiUsageRate&{source:string;checkedAt:string;threshold?:number;long?:AiUsageRate};
const openai=(model:string,input:number,output:number,cached:number,extra:Partial<OfficialAiRate>={}):OfficialAiRate=>({input,output,cached,source:`https://developers.openai.com/api/docs/models/${model}`,checkedAt:AI_PRICE_CHECKED_AT,...extra});
const vertex=(input:number,output:number,cached?:number,extra:Partial<OfficialAiRate>={}):OfficialAiRate=>({input,output,...(cached===undefined?{}:{cached}),source:"https://cloud.google.com/vertex-ai/generative-ai/pricing",checkedAt:AI_PRICE_CHECKED_AT,...extra});

// shortcut: bundled official prices in USD / million; refresh the snapshot when providers change prices.
const PRICES:Record<string,Record<string,OfficialAiRate>>={
  openai:{
    "gpt-5.6-luna":openai("gpt-5.6-luna",0.20,1.20,0.02,{cacheWrite:0.25,threshold:272_000,long:{input:0.40,output:1.80,cached:0.04,cacheWrite:0.50}}),
    "gpt-4o":openai("gpt-4o",2.50,10,1.25),
    "gpt-4o-mini":openai("gpt-4o-mini",0.15,0.60,0.075),
    "gpt-4.1":openai("gpt-4.1",2,8,0.50),
    "gpt-4.1-mini":openai("gpt-4.1-mini",0.40,1.60,0.10),
    "gpt-4.1-nano":openai("gpt-4.1-nano",0.10,0.40,0.025),
    "gpt-6-astra":openai("gpt-6-astra",10,50,1,{cacheWrite:12.50,threshold:272_000,source:"https://developers.openai.com/api/docs/pricing"}),
    "gpt-6.1-sol":openai("gpt-6.1-sol",2,10,0.10,{cacheWrite:2.50,threshold:272_000,source:"https://developers.openai.com/api/docs/pricing"}),
    "gpt-6.1-terra":openai("gpt-6.1-terra",1,5,0.05,{cacheWrite:1.25,threshold:272_000,source:"https://developers.openai.com/api/docs/pricing"}),
    "gpt-6-luna":openai("gpt-6-luna",0.10,0.50,0.01,{cacheWrite:0.125,threshold:272_000,source:"https://developers.openai.com/api/docs/pricing"}),
    "gpt-image-2.5-flare":openai("gpt-image-2.5-flare",5,30,1.25,{source:"https://developers.openai.com/api/docs/pricing"}),
  },
  vertex:{
    "gemini-3.1-flash-image":vertex(0.50,60),
    "gemini-2.5-pro":vertex(1.25,10,0.125,{threshold:200_000,long:{input:2.50,output:15,cached:0.25}}),
    "gemini-2.5-flash":vertex(0.30,2.50,0.03),
    "gemini-2.5-flash-lite":vertex(0.10,0.40,0.01),
    "gemini-2.0-flash":vertex(0.15,0.60),
    "gemini-2.0-flash-lite":vertex(0.075,0.30),
  },
  groq:{
    "openai/gpt-oss-20b":{input:0.075,output:0.30,source:"https://console.groq.com/docs/model/openai/gpt-oss-20b",checkedAt:AI_PRICE_CHECKED_AT},
  },
  gemini:{
    "gemini-3.1-flash-image":{input:0.50,output:60,source:"https://ai.google.dev/gemini-api/docs/pricing",checkedAt:AI_PRICE_CHECKED_AT},
  },
};
const SNAPSHOTS:Record<string,string>={
  "gpt-4o-mini-2024-07-18":"gpt-4o-mini",
  "gpt-4.1-2025-04-14":"gpt-4.1",
  "gpt-4.1-mini-2025-04-14":"gpt-4.1-mini",
  "gpt-4.1-nano-2025-04-14":"gpt-4.1-nano",
};
export function officialAiPriceInfo(provider:string,model:string):OfficialAiRate|undefined {
  const key=provider==="openai"&&Object.hasOwn(SNAPSHOTS,model)?SNAPSHOTS[model]:model;
  return Object.hasOwn(PRICES,provider)&&Object.hasOwn(PRICES[provider],key)?PRICES[provider][key]:undefined;
}
export function officialAiUsageRate(row:Pick<AiUsageBucket,"provider"|"model"|"feature">&Partial<AiUsageBucket>):OfficialAiRate|undefined {
  const info=officialAiPriceInfo(row.provider,row.model);
  if(!info||row.feature==="transcription"||row.billingTier&&!['default','standard','on_demand'].includes(row.billingTier))return;
  if(row.unpricedCached&&info.cached===undefined)return;
  // Legacy daily aggregates cannot reveal whether individual calls crossed a context-price threshold.
  if(info.threshold&&row.longContext===undefined&&(row.unpricedInput||0)>info.threshold&&(row.requests||0)-(row.unknown||0)-(row.reportedRequests||0)>1)return;
  const long=row.longContext??(!!info.threshold&&(row.unpricedInput||0)>info.threshold);
  if(long&&info.threshold&&!info.long)return;
  return long&&info.long?{...info,...info.long}:info;
}
