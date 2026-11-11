import { useEffect } from 'react';
import { useAppStore } from '@/store/appStore';
import { museQueueSnapshot } from '@/lib/museQueue';
import { musePlaybookSyncActive, shouldAutoSyncPlaybooks, syncMusePlaybooks } from '@/lib/musePlaybookSync';
import { isDataRestoreActive } from '@/store/restoreGuard';

export function PlaybookSyncWatcher() {
  useEffect(() => {
    const check = () => {
      const state = useAppStore.getState(), queue = museQueueSnapshot();
      if (musePlaybookSyncActive() || isDataRestoreActive()) return;
      if (shouldAutoSyncPlaybooks(state.settings, Date.now(), !document.hidden, state.hydrated && state.uiReady, queue.textRunning === 0 && queue.textWaiting === 0)) {
        void syncMusePlaybooks().catch(() => {});
      }
    };
    const startup = window.setTimeout(check, 30_000);
    const interval = window.setInterval(check, 60_000);
    return () => {window.clearTimeout(startup); window.clearInterval(interval);};
  }, []);
  return null;
}
