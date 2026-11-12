type Lane = "text" | "media";
type Task = { priority:number; order:number; run:()=>void; cleanup:()=>void };
const lanes:Record<Lane,{active:boolean;pending:Task[]}>={text:{active:false,pending:[]},media:{active:false,pending:[]}};
const listeners=new Set<()=>void>();
let snapshot={textRunning:0,textWaiting:0,mediaRunning:0,mediaWaiting:0};
let nextOrder=0;
function publish(){snapshot={textRunning:Number(lanes.text.active),textWaiting:lanes.text.pending.length,mediaRunning:Number(lanes.media.active),mediaWaiting:lanes.media.pending.length};for(const listener of listeners)listener();}
export const subscribeMuseQueue=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export const museQueueSnapshot=()=>snapshot;
function pump(lane:Lane){
  const queue=lanes[lane];if(queue.active)return;
  queue.pending.sort((a,b)=>b.priority-a.priority||a.order-b.order);
  const task=queue.pending.shift();if(!task){publish();return;}
  queue.active=true;task.cleanup();publish();task.run();
}
export function enqueueMuseTask<T>(lane:Lane,work:()=>Promise<T>,signal?:AbortSignal,priority=0):Promise<T>{
  if(signal?.aborted)return Promise.reject(signal.reason||new DOMException("Aborted","AbortError"));
  const queue=lanes[lane];
  if(queue.pending.length>=100)return Promise.reject(Error("429 Muse 排队过多，请稍后重试"));
  return new Promise((resolve,reject)=>{
    const remove=(reason:Error)=>{const index=queue.pending.indexOf(task);if(index<0)return;queue.pending.splice(index,1);task.cleanup();reject(reason);publish();};
    const cancel=()=>remove(signal?.reason||new DOMException("Aborted","AbortError"));
    const timer=setTimeout(()=>remove(Error("Muse 排队超过 5 分钟，请重新生成")),300_000);
    const task:Task={priority,order:nextOrder++,cleanup:()=>{clearTimeout(timer);signal?.removeEventListener("abort",cancel);},run:()=>{
      Promise.resolve().then(work).then(resolve,reject).finally(()=>{queue.active=false;publish();pump(lane);});
    }};
    signal?.addEventListener("abort",cancel,{once:true});queue.pending.push(task);publish();queueMicrotask(()=>pump(lane));
  });
}
