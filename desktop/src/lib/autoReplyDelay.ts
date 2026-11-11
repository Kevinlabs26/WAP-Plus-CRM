export function autoReplyDelayRange(settings:{aiAutoReplyDelayMinMs?:number;aiAutoReplyDelayMaxMs?:number}) {
  const bounded=(value:unknown)=>typeof value==="number"&&Number.isFinite(value)?Math.min(300_000,Math.max(0,Math.round(value))):0;
  const min=bounded(settings.aiAutoReplyDelayMinMs);
  return {min,max:Math.max(min,bounded(settings.aiAutoReplyDelayMaxMs))};
}
