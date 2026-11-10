import { mkdir, readdir, readFile, open, rename, unlink, stat } from "node:fs/promises";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { join } from "node:path";

const MAGIC = Buffer.from("WAP-SYNC-1\0");
const BATCH_BYTES = 512 * 1024;
const formatBytes = value => value < 1024 * 1024
  ? `${Math.ceil(value / 1024)} KB`
  : `${(value / (1024 * 1024)).toFixed(1)} MB`;

/** Unacknowledged events are encrypted and fsynced in ordered batches, never evicted. */
export async function createEventSpool(directory, key, { warningBytes = 256 * 1024 * 1024, retryMs = 2000, onPause = () => {} } = {}) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw Error("同步缓存缺少加密密钥，请通过桌面版启动");
  await mkdir(directory, { recursive: true });
  const files = new Map();
  const pending = [];
  let pendingBytes = 0, diskBytes = 0, acknowledged = 0, sequence = 0, writing, retryTimer, writeError = "", recoveryWarning="";
  let receivingPaused=false;
  function pauseReceiving(){if(!receivingPaused){receivingPaused=true;onPause();}}
  const seal = (name, data) => {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(name));
    const bytes = Buffer.concat([cipher.update(data), cipher.final()]);
    return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), bytes]);
  };
  const decode = (name, bytes) => {
    if (!bytes.subarray(0, MAGIC.length).equals(MAGIC)) {
      if(name.endsWith(".pack"))throw Error("同步批次不是有效的加密记录");
      return JSON.parse(bytes.toString("utf8"));
    }
    const start = MAGIC.length, decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(start, start + 12));
    decipher.setAAD(Buffer.from(name));decipher.setAuthTag(bytes.subarray(start + 12, start + 28));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(start + 28)), decipher.final()]).toString("utf8"));
  };
  const atomic = async (name, data) => {
    const target = join(directory, name), temporary = `${target}.tmp`;
    const handle = await open(temporary, "w", 0o600);
    try { await handle.writeFile(seal(name, Buffer.from(data)));await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, target);
  };
  try { acknowledged = decode("checkpoint.json", await readFile(join(directory, "checkpoint.json"))); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (!Number.isSafeInteger(acknowledged) || acknowledged < 0) throw Error("Invalid sync checkpoint");
  sequence = acknowledged;
  let names = (await readdir(directory)).sort();
  if(names.some(name=>name.endsWith(".recovery")))recoveryWarning="上次同步存在未完成片段，已加密保留；请重新同步历史以核对";
  for(const name of names.filter(name=>/^\d{16}-\d{16}\.pack\.tmp$/.test(name))){
    const target=name.slice(0,-4),bytes=await readFile(join(directory,name));
    let complete=false;
    try{const rows=decode(target,bytes);complete=Array.isArray(rows)&&rows.length>0&&rows.at(-1).seq===Number(target.slice(17,33));}catch{/* Preserve uncommitted fragments separately. */}
    if(complete){
      let existing;
      try{existing=await readFile(join(directory,target));}catch(error){if(error.code!=="ENOENT")throw error;}
      if(existing){
        if(JSON.stringify(decode(target,existing))!==JSON.stringify(decode(target,bytes)))throw Error("同步缓存存在冲突批次，已保留原文件");
        await unlink(join(directory,name));
      }else await rename(join(directory,name),join(directory,target));
    }
    else{await atomic(`${target}.${randomBytes(8).toString("hex")}.recovery`,bytes);await unlink(join(directory,name));recoveryWarning="上次同步存在未完成片段，已加密保留；请重新同步历史以核对";}
  }
  names=(await readdir(directory)).sort();
  for(const name of names.filter(name=>name.endsWith(".recovery")))diskBytes+=(await stat(join(directory,name))).size;
  for (const name of names) {
    const legacy = /^(\d{16})\.json$/.exec(name), pack = /^(\d{16})-(\d{16})\.pack$/.exec(name);
    if (!legacy && !pack) continue;
    const end = Number(legacy?.[1] || pack[2]);
    if (!Number.isSafeInteger(end)) throw Error("Invalid sync event sequence");
    const bytes = await readFile(join(directory, name));
    const data = decode(name, bytes), events = legacy ? [data] : data;
    if (!Array.isArray(events) || !events.length || events.at(-1)?.seq !== end || events.some((event, i) => !Number.isSafeInteger(event.seq) || (i && event.seq <= events[i-1].seq))) throw Error("Invalid persisted sync event");
    if (!bytes.subarray(0, MAGIC.length).equals(MAGIC)) await atomic(name, JSON.stringify(data));
    files.set(end, { name, bytes: (await stat(join(directory, name))).size });
    diskBytes += files.get(end).bytes;sequence = Math.max(sequence, end);
  }
  // Old atomic writes can leave plaintext temporary records; recover before removing them.
  for (const name of names.filter(name => /^\d{16}\.json\.tmp$/.test(name))) {
    const target = name.slice(0, -4), event = decode(target, await readFile(join(directory, name))), seq = Number(target.slice(0,16));
    if (event.seq !== seq) throw Error("旧同步缓存未完成迁移，已保留原文件");
    if (!files.has(seq) && seq > acknowledged) {
      await atomic(target, JSON.stringify(event));
      const size = (await stat(join(directory,target))).size;files.set(seq,{name:target,bytes:size});diskBytes+=size;sequence=Math.max(sequence,seq);
    }
    await unlink(join(directory, name)).catch(error=>{if(error.code!=="ENOENT")throw error;});
  }
  const sorted = [...files].sort(([a],[b])=>a-b);files.clear();for(const [end,file] of sorted)files.set(end,file);
  const prune = async () => {
    for (const [end, file] of files) {
      if (end > acknowledged) break;
      try { await unlink(join(directory, file.name)); }
      catch (error) { if (error.code !== "ENOENT") { writeError="同步缓存清理失败";break; } }
      files.delete(end);diskBytes-=file.bytes;
    }
  };
  await prune();await atomic("checkpoint.json", JSON.stringify(acknowledged));
  function drain(through = sequence) {
    if (writing) return writing;
    clearTimeout(retryTimer);
    writing = (async () => {
      while (pending.length && pending[0].seq <= through) {
        let bytes = 0, count = 0;
        while (count < pending.length && pending[count].seq <= through && count < 128 && (!count || bytes < BATCH_BYTES)) bytes += pending[count++].bytes;
        const batch = pending.slice(0,count), first = batch[0].seq, end = batch.at(-1).seq;
        const name = `${String(first).padStart(16,"0")}-${String(end).padStart(16,"0")}.pack`;
        await atomic(name, `[${batch.map(row=>row.json).join(",")}]`);
        const size = (await stat(join(directory,name))).size;
        files.set(end,{name,bytes:size});diskBytes+=size;
        pending.splice(0,count);pendingBytes-=bytes;writeError="";
      }
    })().catch(error=>{writeError=`同步缓存写入失败：${error.code || "磁盘不可用"}`;pauseReceiving();throw error;}).finally(()=>{
      writing=undefined;
      if (pending.length) { retryTimer=setTimeout(()=>{void drain().catch(()=>{});},writeError?retryMs:0);retryTimer.unref?.(); }
    });
    return writing;
  }
  let checkpoint = Promise.resolve();
  const flushThrough=async ceiling=>{while(pending.length&&pending[0].seq<=ceiling)await drain(ceiling);};
  return {
    get sequence() { return sequence; },
    get health() {
      const backlog = pendingBytes > 32 * 1024 * 1024 || diskBytes > warningBytes;
      const warningCode = receivingPaused ? "paused" : writeError ? "write-error" : backlog ? "backlog" : recoveryWarning ? "recovery" : "";
      const warning = receivingPaused
        ? `${writeError ? `${writeError}；` : ""}已暂停接收，请检查磁盘空间和写入权限后重连${pendingBytes ? `；约 ${formatBytes(pendingBytes)} 尚未落盘，请勿退出` : ""}`
        : writeError || (backlog
          ? `同步缓存积压：${formatBytes(diskBytes)}，${files.size} 个批次等待本地保存确认。未确认的数据不会自动删除`
          : recoveryWarning);
      return { pendingBytes, diskBytes, files: files.size, writeError, receivingPaused, blocked: Boolean(receivingPaused || writeError || backlog), warningCode, warning };
    },
    record(event) {
      if (!Number.isSafeInteger(event.seq) || event.seq <= sequence) throw Error("Out-of-order sync event");
      sequence=event.seq;
      if (event.type === "presence.update") return;
      const json=JSON.stringify(event), bytes=Buffer.byteLength(json);
      pending.push({seq:event.seq,json,bytes});pendingBytes+=bytes;
      if(writeError||pendingBytes>32*1024*1024)pauseReceiving();
      queueMicrotask(()=>{void drain().catch(()=>{});});
    },
    async flush() { await flushThrough(sequence); },
    acknowledge(cursor) {
      const next=checkpoint.then(async()=>{
        if (!Number.isSafeInteger(cursor) || cursor <= acknowledged || cursor > sequence) return;
        await flushThrough(cursor);await atomic("checkpoint.json",JSON.stringify(cursor));acknowledged=cursor;writeError="";await prune();
      });
      checkpoint=next.catch(error=>{writeError=`同步确认写入失败：${error.code||"磁盘不可用"}`;pauseReceiving();});return next;
    },
    recover() {
      const next=checkpoint.then(async()=>{
        await flushThrough(sequence);await atomic("checkpoint.json",JSON.stringify(acknowledged));writeError="";
        await prune();if(writeError)throw Error(writeError);
        receivingPaused=false;
      });
      checkpoint=next.catch(error=>{writeError=`同步存储尚未恢复：${error.code||"磁盘不可用"}`;pauseReceiving();});return next;
    },
    async readRecentMessages(after, itemLimit = 200) {
      const ceiling = sequence;
      const next = checkpoint.then(async () => {
        await flushThrough(ceiling);
        const floor = Math.max(after, acknowledged);
        const selected = [];
        let itemsLeft = itemLimit, scannedBytes = 0, scannedFiles = 0;
        for (const [end, file] of [...files].reverse()) {
          if (end <= floor || itemsLeft <= 0 || scannedFiles >= 256 || scannedBytes + file.bytes > 8 * 1024 * 1024) break;
          scannedFiles++; scannedBytes += file.bytes;
          const rows = decode(file.name, await readFile(join(directory, file.name)));
          for (const event of (Array.isArray(rows) ? rows : [rows]).reverse()) {
            if (event.seq <= floor || event.seq > ceiling || event.type !== "messages.sync" || !Array.isArray(event.payload?.items)) continue;
            const items = event.payload.items.slice(-itemsLeft);
            if (!items.length) continue;
            selected.push({ ...event, payload: { ...event.payload, items, live: false, source: "startup-catchup", syncBatchFinal: false } });
            itemsLeft -= items.length;
            if (!itemsLeft) break;
          }
        }
        return selected.reverse();
      });
      checkpoint = next.then(() => {}, () => {});
      return next;
    },
    async read(after, recent = [], limit = 40) {
      const ceiling=sequence;
      const next=checkpoint.then(async()=>{
      await flushThrough(ceiling);
      const floor=Math.max(after,acknowledged);
      const merged = new Map();
      for (const [end,file] of files) {
        if (end<=floor)continue;
        const data=decode(file.name,await readFile(join(directory,file.name)));
        for(const event of Array.isArray(data)?data:[data])if(event.seq>floor&&event.seq<=ceiling)merged.set(event.seq,event);
        if(merged.size>=limit)break;
      }
      for (const event of recent) if (event.seq > floor && event.seq <= ceiling) merged.set(event.seq, event);
      return [...merged.values()].sort((a, b) => a.seq - b.seq).slice(0, limit);
      });
      checkpoint=next.then(()=>{},()=>{});return next;
    },
  };
}
