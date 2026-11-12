import { useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/primitives';
import { generateMuseWeb, museWebStatus, openMuseWeb, switchMuseWebAccount } from '@/lib/museWeb';
import { museQueueSnapshot, subscribeMuseQueue } from '@/lib/museQueue';
import { useAppStore } from '@/store/appStore';
import { useI18n } from '@/i18n';
import {MuseQueueStatus} from './MuseQueueStatus';

export function MuseWebFields(){
  const {t}=useI18n();
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(false);
  const queue=useSyncExternalStore(subscribeMuseQueue,museQueueSnapshot);
  const queueBusy=!!(queue.textRunning||queue.textWaiting||queue.mediaRunning||queue.mediaWaiting);
  const run=async(work:()=>Promise<string>)=>{
    if(busy)return;setBusy(true);setError(false);
    try{setMessage(await work());}catch(e){setError(true);setMessage(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  };
  const switchAccount=async()=>{
    if(busy||queueBusy)return;
    if(!await useAppStore.getState().requestConfirm({title:t('muse.switch'),description:t('muse.switchConfirm'),confirmLabel:t('muse.switch'),tone:'danger'}))return;
    await run(async()=>{
      useAppStore.getState().updateSettings({aiAutoReplyPaused:true});
      await switchMuseWebAccount();return t('muse.switchHint');
    });
  };
  return <div className="col-span-2 space-y-2 rounded-lg border border-zinc-800 p-3">
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" disabled={busy} onClick={()=>void run(async()=>{await openMuseWeb();return t('muse.loginHint');})}>{t('muse.open')}</Button>
      <span title={queueBusy?t('muse.switchBusy'):undefined}><Button size="sm" variant="secondary" disabled={busy||queueBusy} onClick={()=>void switchAccount()}>{t('muse.switch')}</Button></span>
      <Button size="sm" variant="secondary" disabled={busy} onClick={()=>void run(async()=>{const status=await museWebStatus();if(!status.ready)throw Error(status.message);return t('muse.ready');})}>{t('muse.check')}</Button>
      <Button size="sm" disabled={busy} onClick={()=>void run(async()=>{await generateMuseWeb('这是一条连接测试。请仅回复 OK，不要使用任何工具，也不要执行其他操作。',undefined,'connection-test');return t('muse.testOK');})}>{t('muse.test')}</Button>
    </div>
    <p className="text-2xs text-zinc-500" title={t('muse.rollover')}>{t('muse.hint')}</p>
    <MuseQueueStatus/>
    {message&&<p role={error?'alert':'status'} className={`text-xs ${error?'text-amber-500':'text-brand'}`}>{message}</p>}
  </div>;
}
