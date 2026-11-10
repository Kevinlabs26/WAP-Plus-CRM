import {useSyncExternalStore} from "react";
import {museQueueSnapshot,subscribeMuseQueue} from "@/lib/museQueue";
import {useI18n} from "@/i18n";
export function MuseQueueStatus(){
  const state=useSyncExternalStore(subscribeMuseQueue,museQueueSnapshot);
  const {t}=useI18n();
  if(!state.textRunning&&!state.textWaiting&&!state.mediaRunning&&!state.mediaWaiting)return null;
  return <p role="status" className="mt-1 text-[11px] text-zinc-500">{t("muse.queueStatus",{...state})}</p>;
}
