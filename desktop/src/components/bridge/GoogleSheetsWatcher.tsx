import { useEffect } from "react";
import { initializeSheets, refreshSheets } from "@/lib/googleSheets";
export function GoogleSheetsWatcher() {
  useEffect(() => {
    let stopped = false;
    const tick = () => { if (!stopped) void refreshSheets(); };
    void initializeSheets().then(tick);
    const timer = window.setInterval(tick, 60_000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, []);
  return null;
}
