import { MAX_WORKBOOK_BYTES, type QuickReplyWorkbookSheet } from "./quickReplyWorkbook";

export async function readQuickReplyWorkbookInWorker(file: File): Promise<QuickReplyWorkbookSheet[]> {
  if (!file.size || file.size > MAX_WORKBOOK_BYTES) throw new Error("limit");
  const bytes = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./quickReplyWorkbook.worker.ts", import.meta.url));
    worker.onmessage = (event: MessageEvent<{ sheets: QuickReplyWorkbookSheet[] } | { error: string }>) => {
      worker.terminate();
      if ("error" in event.data) reject(new Error(event.data.error));
      else resolve(event.data.sheets);
    };
    const fail = () => { worker.terminate(); reject(new Error("format")); };
    worker.onerror = fail;
    worker.onmessageerror = fail;
    try { worker.postMessage(bytes, [bytes]); } catch { fail(); }
  });
}
