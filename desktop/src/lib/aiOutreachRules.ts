export type AiOutreachRule = {
  enabled: boolean; paused?: boolean; mode: "draft" | "auto"; trigger: "new" | "daily" | "both";
  time: string; timeZone: string; minIdleHours: number; dailyLimit: number; goal: string; runNowAt?: number; firstContactQuotas?: Record<string,number>; firstContactAssignments?: Record<string,string>;
};
export type AiOutreachRun = {
  id: string; folderId: string; chatId: string; accountId: string; day: string; at: string;
  status: "generating" | "draft" | "queued" | "sent" | "failed" | "cancelled";
  text?: string; error?: string; messageId?: string; basisAt: string; contextHash?: string;
  approved?: boolean;
  recipient?: string;
};
export const outreachGoal = (rule: AiOutreachRule) => rule.goal || "Initiate or resume contact naturally, following the configured conversation instructions. Respect the conversation history and any request to stop.";
export function normalizeOutreachRule(raw: unknown): AiOutreachRule {
  const value = raw && typeof raw === "object" ? raw as Partial<AiOutreachRule> : {};
  let zone = typeof value.timeZone === "string" ? value.timeZone : "UTC";
  try {new Intl.DateTimeFormat("en",{timeZone:zone});} catch {zone="UTC";}
  const number = (value: unknown, fallback: number, min: number, max: number) => typeof value === "number" && Number.isFinite(value) ? Math.min(max,Math.max(min,Math.round(value))) : fallback;
  const quotas=value.firstContactQuotas&&typeof value.firstContactQuotas==='object'?Object.fromEntries(Object.entries(value.firstContactQuotas).filter(([id,n])=>id.length<=200&&typeof n==='number'&&Number.isFinite(n)).slice(0,100).map(([id,n])=>[id,Math.min(100,Math.max(0,Math.floor(n)))])):undefined;
  const assignments=quotas&&value.firstContactAssignments&&typeof value.firstContactAssignments==='object'?Object.fromEntries(Object.entries(value.firstContactAssignments).filter(([key,id])=>key.length<=200&&typeof id==='string'&&Object.hasOwn(quotas,id)).slice(0,10000)):undefined;
  return {...(quotas?{firstContactQuotas:quotas,firstContactAssignments:assignments||{}}:{}),...(typeof value.runNowAt === "number" && Number.isFinite(value.runNowAt) ? {runNowAt:value.runNowAt} : {}), enabled: value.enabled === true, ...(value.paused===true?{paused:true}:{}), mode: value.mode === "auto" ? "auto" : "draft", trigger: value.trigger === "new" ? "new" : value.trigger==="both"?"both":"daily",
    time: typeof value.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.time) ? value.time : "09:00", timeZone: zone,
    minIdleHours: number(value.minIdleHours,12,1,168), dailyLimit: number(value.dailyLimit,10,1,100), goal: typeof value.goal === "string" ? value.goal.trim().slice(0,2000) : ""};
}
export function normalizeOutreachRuns(raw: unknown): AiOutreachRun[] {
  const seen = new Set<string>();
  return (Array.isArray(raw) ? raw : []).slice(-10_000).flatMap(value => {
    if (!value || !["id","folderId","chatId","accountId","day","at","basisAt"].every(key => typeof value[key] === "string" && value[key].length <= 200) ||
        !value.id || seen.has(value.id) || !["generating","draft","queued","sent","failed","cancelled"].includes(value.status)) return [];
    seen.add(value.id);
    return [{id:value.id, folderId:value.folderId, chatId:value.chatId, accountId:value.accountId, day:value.day, at:value.at, basisAt:value.basisAt,
      status:value.status, text:typeof value.text === "string" ? value.text.slice(0,4000) : undefined,
      error:typeof value.error === "string" ? value.error.slice(0,500) : undefined, messageId:typeof value.messageId === "string" ? value.messageId.slice(0,200) : undefined,
      contextHash:typeof value.contextHash === "string" && /^[a-f0-9]{64}$/.test(value.contextHash) ? value.contextHash : undefined,approved:value.approved===true,
      recipient:typeof value.recipient==="string"?value.recipient.slice(0,200):undefined}];
  });
}
const clockFormats=new Map<string,Intl.DateTimeFormat>();
const clockMinutes=new Map<string,{day:string;time:string}>();
export function outreachClock(timeZone: string, now = Date.now()) {
  const key=`${timeZone}:${Math.floor(now/60_000)}`,cached=clockMinutes.get(key);
  if(cached){clockMinutes.delete(key);clockMinutes.set(key,cached);return cached;}
  let format=clockFormats.get(timeZone);
  if(!format){format=new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});clockFormats.set(timeZone,format);if(clockFormats.size>64)clockFormats.delete(clockFormats.keys().next().value!);}
  const parts = format.formatToParts(now);
  const get = (name: string) => parts.find(part=>part.type===name)!.value;
  const result={day:`${get("year")}-${get("month")}-${get("day")}`,time:`${get("hour")}:${get("minute")}`};
  clockMinutes.set(key,result);if(clockMinutes.size>256)clockMinutes.delete(clockMinutes.keys().next().value!);
  return result;
}

export function isImmediateOutreach(rule: {runNowAt?:number}, now=Date.now()): boolean {
  return typeof rule.runNowAt === "number" && now >= rule.runNowAt && now - rule.runNowAt < 2 * 3600_000;
}

export function outreachWindowOffset(rule:Pick<AiOutreachRule,"time"|"timeZone">,now=Date.now()) {
  const time=outreachClock(rule.timeZone,now).time;
  return (Number(time.slice(0,2))*60+Number(time.slice(3))-Number(rule.time.slice(0,2))*60-Number(rule.time.slice(3))+1440)%1440;
}
export function outreachRunClock(rule:Pick<AiOutreachRule,"time"|"timeZone"|"runNowAt">,now=Date.now()) {
  const clock=outreachClock(rule.timeZone,now);
  if(isImmediateOutreach(rule,now))return {...clock,day:outreachClock(rule.timeZone,rule.runNowAt!).day};
  const start=Number(rule.time.slice(0,2))*60+Number(rule.time.slice(3));
  const minutes=Number(clock.time.slice(0,2))*60+Number(clock.time.slice(3));
  return outreachWindowOffset(rule,now)<120&&minutes<start ? {...clock,day:outreachClock(rule.timeZone,now-120*60_000).day}:clock;
}

/** Search actual instants so missing and repeated daylight-saving hours follow the runner's window. */
export function nextOutreachWindow(rule:Pick<AiOutreachRule,"time"|"timeZone"|"runNowAt">,now=Date.now(),skipToday=false):number|null {
  if (!skipToday && isImmediateOutreach(rule,now)) return now;
  const today=outreachClock(rule.timeZone,now).day;
  const inside=(at:number)=>{const clock=outreachRunClock(rule,at),late=outreachWindowOffset(rule,at);return (!skipToday||clock.day>today)&&late>=0&&late<120;};
  if(inside(now))return now;
  for(let at=Math.ceil(now/60_000)*60_000;at<=now+27*3600_000;at+=60_000)if(inside(at))return at;
  return null;
}
