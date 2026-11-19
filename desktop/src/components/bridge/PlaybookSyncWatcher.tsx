import { useEffect } from 'react';
import { useAppStore } from '@/store/appStore';
import { museQueueSnapshot } from '@/lib/museQueue';
import { musePlaybookSyncActive, shouldAutoSyncPlaybooks, syncMusePlaybooks } from '@/lib/musePlaybookSync';
import { isDataRestoreActive } from '@/store/restoreGuard';

let controller: AbortController | undefined;
let status: 'idle' | 'scan' | 'paused' = 'idle';
const listeners = new Set<() => void>();
export const backgroundPlaybookSyncStatus = () => status;
export function subscribeBackgroundPlaybookSync(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function setStatus(next: typeof status) {
  status = next;
  listeners.forEach(listener => listener());
}
export function toggleBackgroundPlaybookSync() {
  if (status === 'paused') {
    setStatus('idle');
    return;
  }
  setStatus('paused');
  controller?.abort();
}

export function PlaybookSyncWatcher() {
  useEffect(() => {
    const check = () => {
      const state = useAppStore.getState(), queue = museQueueSnapshot();
      if (controller || status === 'paused' || musePlaybookSyncActive() || isDataRestoreActive() ||
          !state.hydrated || !state.uiReady || document.hidden || queue.textRunning || queue.textWaiting) return;
      const scan = shouldAutoSyncPlaybooks(state.settings, Date.now(), true, true, true);
      if (!scan) return;
      const { signal } = controller = new AbortController();
      setStatus('scan');
      const work = syncMusePlaybooks(false, undefined, signal);
      void work.catch(() => {}).finally(() => {
        controller = undefined;
        if (status !== 'paused') setStatus('idle');
      });
    };
    const startup = window.setTimeout(check, 30_000);
    const interval = window.setInterval(check, 60_000);
    return () => {window.clearTimeout(startup); window.clearInterval(interval); controller?.abort();};
  }, []);
  return null;
}
