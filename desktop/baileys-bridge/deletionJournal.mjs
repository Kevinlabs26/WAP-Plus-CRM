import { mkdirSync, readFileSync, appendFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

// ponytail: 只压缩被覆盖的记录；独立删除信息须等同步检查点确认后才能清理。
export function createDeletionJournal(directory) {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "sync-deletions.jsonl");
  const records = new Map();
  const order = new WeakMap();
  let sequence = 0;
  let lineCount = 0;
  let nextCompaction = 1000;
  let failure;
  const remember = event => {
    order.set(event, sequence++);
    lineCount++;
    const payload = event.payload;
    const keys = event.type === "chats.delete" ? payload.jids || []
      : payload.all ? ["clear:" + payload.jid] : (payload.items || []).map(item => "message:" + item.id);
    for (const key of keys) records.set(event.type + ":" + key, event);
  };
  const liveRecords = () => [...new Set(records.values())];
  const compact = () => {
    if (failure || lineCount < nextCompaction) return;
    nextCompaction = lineCount + 1000;
    const live = liveRecords();
    if (lineCount < live.length * 2) return;
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      // 按原始写入顺序保存，系统时钟回拨也不会改变重启后的覆盖关系。
      live.sort((a, b) => order.get(a) - order.get(b));
      writeFileSync(temp, live.map(event => JSON.stringify(event) + "\n").join(""),
        { encoding: "utf8", flag: "wx", mode: 0o600, flush: true });
      renameSync(temp, path);
      lineCount = live.length;
      nextCompaction = lineCount + 1000;
    } catch (error) {
      console.warn("[sync] deletion journal compaction skipped:", error.message);
    } finally {
      try { unlinkSync(temp); } catch (error) {
        if (error.code !== "ENOENT") console.warn("[sync] deletion journal temporary file cleanup failed:", error.message);
      }
    }
  };
  let contents = "";
  try { contents = readFileSync(path, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  for (const line of contents.split("\n")) {
    if (line.trim()) remember(JSON.parse(line));
  }
  compact();
  return {
    record(event) {
      remember(event);
      try { appendFileSync(path, JSON.stringify(event) + "\n", { encoding: "utf8", flush: true }); }
      catch (error) { failure = error; throw error; }
      compact();
    },
    snapshot() {
      if (failure) throw new Error("删除记录保存失败，请检查磁盘并重启 Bridge：" + failure.message);
      return liveRecords().sort((a, b) => a.ts - b.ts || order.get(a) - order.get(b));
    },
  };
}
