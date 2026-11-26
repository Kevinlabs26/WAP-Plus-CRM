import assert from "node:assert/strict";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { readQuickReplyWorkbook } from "../src/lib/quickReplyWorkbook.ts";

test("Excel imports every row past the old 1000-reply limit", async () => {
  const workbook = XLSX.utils.book_new();
  const data = Array.from({ length: 1200 }, (_, i) => [`Original ${i}`, `Translation ${i}`]);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Original", "Translation"], ...data]), "Replies");
  const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const [sheet] = await readQuickReplyWorkbook(new File([bytes], "replies.xlsx"));
  assert.deepEqual(sheet.rows, data);
});

test("Excel keeps sparse wide columns and reads past the fiftieth sheet", async () => {
  const workbook = XLSX.utils.book_new();
  for (let i = 0; i < 50; i++) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Original"], ["Text"]]), `Tab ${i}`);
  const wide = { "!ref": "A1:AB12001", A1: { t:"s", v:"Title" }, AA1: { t:"s", v:"Original" }, AB1: { t:"s", v:"Translation" },
    A12001: { t:"s", v:"Long title ".repeat(12) }, AA12001: { t:"s", v:"Original at far row" }, AB12001: { t:"s", v:"Translated" } };
  XLSX.utils.book_append_sheet(workbook, wide, "Wide");
  const sheets = await readQuickReplyWorkbook(new File([XLSX.write(workbook,{ type:"buffer",bookType:"xlsx" })],"wide.xlsx"));
  assert.equal(sheets.length, 51);
  assert.equal(sheets[50].rows.length, 1);
  assert.equal(sheets[50].sendColumn, 26);
  assert.equal(sheets[50].translationColumn, 27);
  assert.equal(sheets[50].rows[0][26], "Original at far row");
});

test("the workbook worker returns all 12,000 rows and preserves far columns across sheets", async () => {
  const count = 12000;
  const workbook = XLSX.utils.book_new();
  for (let i = 0; i < 51; i++) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Original"], [`Text ${i}`]]), `Tab ${i}`);
  const rows = [["Title", ...Array(25), "Original", "Translation"], ...Array.from({ length: count }, (_, i) => [`Title ${i}`, ...Array(25), `Body ${i}`, `Translation ${i}`])];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Large");
  const file = new File([XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })], "large.xlsx");
  const bundled = await build({ entryPoints: [fileURLToPath(new URL("../src/lib/quickReplyWorkbook.worker.ts", import.meta.url))], write: false, bundle: true, platform: "node", format: "cjs" });
  const worker = new Worker(`const { parentPort } = require('node:worker_threads'); globalThis.self = { postMessage: data => parentPort.postMessage(data) }; parentPort.on('message', data => self.onmessage({ data }));\n${bundled.outputFiles[0].text}`, { eval: true });
  try {
    const bytes = await file.arrayBuffer();
    const result = await new Promise((resolve, reject) => {
      worker.once("message", resolve);
      worker.once("error", reject);
      worker.postMessage(bytes, [bytes]);
    });
    assert.equal(result.sheets?.length, 52, result.error);
    const large = result.sheets.at(-1);
    assert.equal(large.rows.length, count);
    assert.deepEqual([large.titleColumn, large.sendColumn, large.translationColumn], [0, 26, 27]);
    for (let i = 0; i < count; i++) assert.deepEqual([large.rows[i][0], large.rows[i][26], large.rows[i][27]], [`Title ${i}`, `Body ${i}`, `Translation ${i}`]);
  } finally { await worker.terminate(); }
});
