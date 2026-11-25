import { normalizeAiDecisionDetails, type AiDecisionDetails } from "./aiDecisionDetails.ts";

export type AiOutreachRule = {
  enabled: boolean; paused?: boolean; mode: "draft" | "auto"; allowSidebarData?: boolean;
  startMode: "scheduled" | "immediate"; time: string; timeZone: string; goal: string; runNowAt?: number; scheduleStartAt?: number;
  firstContactQuotas?: Record<string, number>;
  firstContactAssignments?: Record<string, string>;
  scheduledFirstContactAssignments?: Record<string, string | null>;
};
export type AiOutreachRun = {
  id: string; folderId: string; chatId: string; accountId: string; day: string; at: string;
  status: "waiting" | "generating" | "draft" | "queued" | "sent" | "skipped" | "failed" | "cancelled" | "expired";
  text?: string; error?: string; messageId?: string; basisAt: string; contextHash?: string; skipReason?: string;
  approved?: boolean; roundAt?: number;
  expiresAt?: number;
  archived?: boolean;
  autoEvidence?: boolean;
  decisionDetails?: AiDecisionDetails;
  recipient?: string;
};
export const outreachGoal = (rule: AiOutreachRule) => rule.goal || "Initiate or resume contact naturally, following the configured conversation instructions. Respect the conversation history and any request to stop.";
export function normalizeOutreachRule(raw: unknown): AiOutreachRule {
  const value = raw && typeof raw === "object" ? raw as Partial<AiOutreachRule> : {};
  const runNowAt=typeof value.runNowAt === "number" && Number.isFinite(value.runNowAt) ? value.runNowAt : undefined;
  let zone = typeof value.timeZone === "string" ? value.timeZone : "UTC";
  try {new Intl.DateTimeFormat("en",{timeZone:zone});} catch {zone="UTC";}
  const entries = (input: unknown) => input && typeof input === "object" && !Array.isArray(input) ? Object.entries(input) : [];
  const quotas = value.firstContactQuotas && Object.fromEntries(entries(value.firstContactQuotas)
    .filter(([id, count]) => id.length <= 200 && Number.isInteger(count) && count >= 0 && count <= 100).slice(0, 100));
  const counts = new Map<string, number>();
  const acceptAssignment = ([recipient, account]: [string, unknown]) => {
    if (!quotas) return false;
    if (recipient.length > 200 || typeof account !== "string" || !Object.hasOwn(quotas, account)) return false;
    const count = counts.get(account) || 0;
    if (count >= quotas[account]) return false;
    counts.set(account, count + 1);
    return true;
  };
  const assignments = quotas && Object.fromEntries(entries(value.firstContactAssignments).filter(acceptAssignment));
  const scheduledEntries = entries(value.scheduledFirstContactAssignments);
  const overridden = scheduledEntries.filter(([recipient, account]) => Object.hasOwn(assignments || {}, recipient) &&
    (account === null || typeof account === "string" && !!quotas && Object.hasOwn(quotas, account)));
  for (const [recipient] of overridden) {
    const account = assignments![recipient];
    counts.set(account, (counts.get(account) || 0) - 1);
  }
  const scheduledAssignments = quotas && Object.fromEntries([...overridden.map(([recipient]) => [recipient,null]), ...scheduledEntries.filter(acceptAssignment)]);
  return {...(quotas ? {firstContactQuotas:quotas,firstContactAssignments:assignments} : {}), ...(runNowAt!==undefined?{runNowAt}:{}), ...(typeof value.scheduleStartAt==="number"&&Number.isFinite(value.scheduleStartAt)?{scheduleStartAt:value.scheduleStartAt}:{}), ...(value.allowSidebarData===true?{allowSidebarData:true}:{}), enabled: value.enabled === true, ...(value.paused===true?{paused:true}:{}), mode: value.mode === "auto" ? "auto" : "draft", startMode:value.startMode==="immediate"&&runNowAt!==undefined?"immediate":"scheduled",
    time: typeof value.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.time) ? value.time : "09:00", timeZone: zone,
    goal: typeof value.goal === "string" ? value.goal.trim().slice(0,2000) : "",
    ...(scheduledAssignments && Object.keys(scheduledAssignments).length ? {scheduledFirstContactAssignments: scheduledAssignments} : {})};
}
export const OUTREACH_IMMEDIATE_WINDOW_MS = 2 * 3600_000;
export const isPendingOutreachRun = (run: AiOutreachRun) => ["waiting", "generating", "draft", "queued"].includes(run.status);

export function normalizeOutreachRuns(raw: unknown): AiOutreachRun[] {
  const seen = new Set<string>();
  return (Array.isArray(raw) ? raw : []).flatMap(value => {
    if (!value || !["id","folderId","chatId","accountId","day","at","basisAt"].every(key => typeof value[key] === "string" && value[key].length <= 200) ||
        !value.id || seen.has(value.id) || !["waiting","generating","draft","queued","sent","skipped","failed","cancelled","expired"].includes(value.status)) return [];
    seen.add(value.id);
    const decisionDetails=normalizeAiDecisionDetails(value.decisionDetails);
    const roundAt = typeof value.roundAt === "number" && Number.isFinite(value.roundAt) ? value.roundAt : undefined;
    return [{id:value.id, folderId:value.folderId, chatId:value.chatId, accountId:value.accountId, day:value.day, at:value.at, basisAt:value.basisAt,
      status:value.status, text:typeof value.text === "string" ? value.text.slice(0,4000) : undefined,
      error:typeof value.error === "string" ? value.error.slice(0,500) : undefined, messageId:typeof value.messageId === "string" ? value.messageId.slice(0,200) : undefined,
      skipReason:typeof value.skipReason === "string" ? value.skipReason.slice(0,500) : undefined,
      autoEvidence:value.autoEvidence===true && !!decisionDetails?.evidence && !!decisionDetails.reason,
      decisionDetails,
      contextHash:typeof value.contextHash === "string" && /^[a-f0-9]{64}$/.test(value.contextHash) ? value.contextHash : undefined,approved:value.approved===true,
      recipient:typeof value.recipient==="string"?value.recipient.slice(0,200):undefined,
      roundAt,
      expiresAt:typeof value.expiresAt==="number"&&Number.isFinite(value.expiresAt)?value.expiresAt:roundAt===undefined?undefined:roundAt+OUTREACH_IMMEDIATE_WINDOW_MS,
      archived:value.archived===true&&!isPendingOutreachRun(value)||undefined}];
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
  return typeof rule.runNowAt === "number" && now >= rule.runNowAt && now - rule.runNowAt < OUTREACH_IMMEDIATE_WINDOW_MS;
}

export function outreachRunExpired(run: AiOutreachRun, rule: AiOutreachRule | undefined, now = Date.now()): boolean {
  if (run.status === "expired") return true;
  if (run.roundAt !== undefined || run.expiresAt !== undefined) {
    const deadline = Math.min(run.expiresAt ?? Infinity, (run.roundAt ?? Infinity) + OUTREACH_IMMEDIATE_WINDOW_MS);
    return now >= deadline;
  }
  return !!rule && outreachClock(rule.timeZone, now).day > run.day;
}

export function outreachRunClock(rule:Pick<AiOutreachRule,"time"|"timeZone"|"runNowAt"|"startMode">,now=Date.now()) {
  const clock=outreachClock(rule.timeZone,now);
  if(rule.startMode==="immediate"&&typeof rule.runNowAt==="number")return {...clock,day:outreachClock(rule.timeZone,rule.runNowAt).day};
  if(isImmediateOutreach(rule,now))return {...clock,day:outreachClock(rule.timeZone,rule.runNowAt!).day};
  return clock;
}

/** Search actual instants so missing and repeated daylight-saving hours follow the runner's schedule. */
export function nextOutreachWindow(rule:Pick<AiOutreachRule,"time"|"timeZone"|"runNowAt"|"startMode"|"scheduleStartAt">,now=Date.now(),skipToday=false):number|null {
  if(rule.startMode==="immediate")return !skipToday&&isImmediateOutreach(rule,now)?now:null;
  if(!skipToday&&rule.scheduleStartAt!==undefined&&now<rule.scheduleStartAt)return rule.scheduleStartAt;
  if (!skipToday && isImmediateOutreach(rule,now)) return now;
  const today=outreachClock(rule.timeZone,now).day;
  const current=outreachClock(rule.timeZone,now);
  if(!skipToday&&current.time>=rule.time)return now;
  for(let at=Math.ceil(now/60_000)*60_000;at<=now+27*3600_000;at+=60_000){
    const clock=outreachClock(rule.timeZone,at);
    if(clock.time>=rule.time&&(!skipToday||clock.day>today))return at;
  }
  return null;
}
export function nextScheduledOutreachAt(rule:Pick<AiOutreachRule,"time"|"timeZone">,now=Date.now()) {
  const current=outreachClock(rule.timeZone,now);
  return nextOutreachWindow({...rule,startMode:"scheduled" as const},now,current.time>rule.time);
}
