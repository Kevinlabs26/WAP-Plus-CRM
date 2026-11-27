type Lane = "text" | "media";
type Task = { priority:number; order:number; run:()=>void; cleanup:()=>void };
type AccountQueue = { active:boolean; pending:Task[] };
const lanes:Record<Lane,Map<string,AccountQueue>>={text:new Map(),media:new Map()};
const listeners=new Set<()=>void>();
let snapshot={textRunning:0,textWaiting:0,mediaRunning:0,mediaWaiting:0};
let nextOrder=0;
function publish(){
  snapshot={textRunning:[...lanes.text.values()].filter(queue=>queue.active).length,textWaiting:[...lanes.text.values()].reduce((sum,queue)=>sum+queue.pending.length,0),mediaRunning:[...lanes.media.values()].filter(queue=>queue.active).length,mediaWaiting:[...lanes.media.values()].reduce((sum,queue)=>sum+queue.pending.length,0)};
  for (const listener of listeners) {
    try { listener(); } catch (error) { console.error("Muse queue listener failed", error); }
  }
}
export const subscribeMuseQueue=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export const museQueueSnapshot=()=>snapshot;
function pump(lane:Lane,accountId:string){
  const queues=lanes[lane],queue=queues.get(accountId);if(!queue||queue.active)return;
  queue.pending.sort((a,b)=>b.priority-a.priority||a.order-b.order);
  const task=queue.pending.shift();if(!task){if(!queue.active)queues.delete(accountId);publish();return;}
  queue.active=true;task.cleanup();publish();task.run();
}
export function enqueueMuseTask<T>(lane:Lane,work:(signal:AbortSignal)=>Promise<T>,signal?:AbortSignal,priority=0,accountId="default",runTimeoutMs=480_000):Promise<T>{
  if(signal?.aborted)return Promise.reject(signal.reason||new DOMException("Aborted","AbortError"));
  let queue=lanes[lane].get(accountId);
  if(!queue){queue={active:false,pending:[]};lanes[lane].set(accountId,queue);}
  if([...lanes[lane].values()].reduce((sum,item)=>sum+item.pending.length,0)>=100)return Promise.reject(Error("429 Muse 排队过多，请稍后重试"));
  return new Promise((resolve,reject)=>{
    const remove=(reason:Error)=>{const index=queue!.pending.indexOf(task);if(index<0)return;queue!.pending.splice(index,1);task.cleanup();if(!queue!.active&&!queue!.pending.length)lanes[lane].delete(accountId);reject(reason);publish();};
    const cancel=()=>remove(signal?.reason||new DOMException("Aborted","AbortError"));
    const timer=setTimeout(()=>remove(Error("Muse 排队超过 5 分钟，请重新生成")),300_000);
    const task:Task={priority,order:nextOrder++,cleanup:()=>{clearTimeout(timer);signal?.removeEventListener("abort",cancel);},run:()=>{
      const deadline = new AbortController();
      const runningSignal = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
      const runningTimer = setTimeout(() => deadline.abort(Error("Muse 运行超时，已请求取消")), runTimeoutMs);
      let onAbort = () => {};
      const aborted = new Promise<never>((_, rejectRun) => {
        onAbort = () => rejectRun(runningSignal.reason);
        if (runningSignal.aborted) onAbort();
        else runningSignal.addEventListener("abort", onAbort, {once:true});
      });
      const running = Promise.resolve().then(() => {
        runningSignal.throwIfAborted();
        return work(runningSignal);
      });
      Promise.race([running, aborted]).finally(() => {
        clearTimeout(runningTimer);
        runningSignal.removeEventListener("abort", onAbort);
        queue!.active = false;
        pump(lane, accountId);
      }).then(resolve, reject);
    }};
    signal?.addEventListener("abort",cancel,{once:true});queue!.pending.push(task);publish();queueMicrotask(()=>pump(lane,accountId));
  });
}
