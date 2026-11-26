import * as XLSX from "xlsx";
import { parseQuickReplyWorkbook } from "./quickReplyWorkbook";

self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  try {
    self.postMessage({ sheets: parseQuickReplyWorkbook(event.data, XLSX) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
