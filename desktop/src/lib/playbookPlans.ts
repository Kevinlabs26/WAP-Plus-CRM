export type PlaybookPlan={id:string;name:string;days:string[]};
export type PlaybookSchedule={planId:string;startDate:string;timeZone:string;switchTime:string};
export function normalizePlaybookPlans(raw:unknown):PlaybookPlan[]{
 const seen=new Set<string>();
 return (Array.isArray(raw)?raw:[]).slice(0,100).flatMap(p=>{
  if(!p||typeof p.id!=='string'||!p.id||p.id.length>120||seen.has(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>120||!Array.isArray(p.days)||!p.days.length||p.days.length>365||p.days.some((id:unknown)=>typeof id!=='string'||!id||id.length>120))return [];
  seen.add(p.id);return [{id:p.id,name:p.name.trim(),days:[...p.days]}];
 });
}
export function normalizePlaybookSchedule(raw:unknown):PlaybookSchedule|undefined {
 if(!raw)return;
 const p=raw as PlaybookSchedule;
 return {planId:typeof p.planId==='string'?p.planId.slice(0,120):'',startDate:typeof p.startDate==='string'?p.startDate.slice(0,10):'',timeZone:typeof p.timeZone==='string'?p.timeZone.slice(0,80):'',switchTime:typeof p.switchTime==='string'?p.switchTime.slice(0,5):''};
}
const formats=new Map<string,Intl.DateTimeFormat>();
const dateNumber=(date:string)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return NaN;const n=Date.parse(date+'T00:00:00Z');return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===date?n:NaN;};
export function scheduledPlaybook(plans:readonly PlaybookPlan[],schedule:PlaybookSchedule,now=Date.now()) {
 const plan=plans.find(p=>p.id===schedule.planId);
 const start=dateNumber(schedule.startDate);
 if(!plan||!plan.days.length)return {id:'',name:'',day:0,next:'',error:'聊天方案已不存在或没有每日内容，请重新选择'};
 if(!Number.isFinite(start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.switchTime))return {id:'',name:plan.name,day:0,next:'',error:'方案开始日期或切换时间无效'};
 let format=formats.get(schedule.timeZone);
 if(!format){try{format=new Intl.DateTimeFormat('en-CA',{timeZone:schedule.timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});}catch{return {id:'',name:plan.name,day:0,next:'',error:'方案时区无效'};}formats.set(schedule.timeZone,format);if(formats.size>100)formats.delete(formats.keys().next().value!);}
 const clock=(at:number)=>{const parts=format!.formatToParts(at),get=(k:string)=>parts.find(p=>p.type===k)!.value;return {date:get('year')+'-'+get('month')+'-'+get('day'),time:get('hour')+':'+get('minute')};};
 const current=clock(now);let switched=current.time>=schedule.switchTime;
 // A repeated DST hour must not roll the plan back after its first switch.
 if(!switched){const before=clock(now-3*3600_000);const wall=(dateNumber(current.date)-dateNumber(before.date))/60000+Number(current.time.slice(0,2))*60+Number(current.time.slice(3))-Number(before.time.slice(0,2))*60-Number(before.time.slice(3));
  if(wall<180)for(let i=1;i<=180&&!switched;i++){const prior=clock(now-i*60000);switched=prior.date===current.date&&prior.time>=schedule.switchTime;}}
 const day=Math.floor((dateNumber(current.date)-start)/86400000)+Number(switched);
 const nextDate=day<1?schedule.startDate:new Date(dateNumber(current.date)+(switched?86400000:0)).toISOString().slice(0,10);
 return {id:day<1?'off':plan.days[Math.min(day,plan.days.length)-1],name:plan.name,day:Math.min(plan.days.length,Math.max(0,day)),ended:day>=plan.days.length,next:day>=plan.days.length?'':nextDate+' '+schedule.switchTime+' · '+schedule.timeZone};
}
