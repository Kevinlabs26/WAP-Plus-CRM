import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const composer = readFileSync(
  new URL("../src/components/chat/Composer.tsx", import.meta.url),
  "utf8"
);
const diagnostics = readFileSync(
  new URL("../src/lib/syncDebug.ts", import.meta.url),
  "utf8"
);
const watcher = readFileSync(
  new URL("../src/components/bridge/BaileysWatcher.tsx", import.meta.url),
  "utf8"
);
const bridgeWatcher = readFileSync(
  new URL("../src/components/bridge/BridgeWatcher.tsx", import.meta.url),
  "utf8"
);
const persist = readFileSync(
  new URL("../src/store/persist.ts", import.meta.url),
  "utf8"
);
const ingestSlice = readFileSync(
  new URL("../src/store/ingestSlice.ts", import.meta.url),
  "utf8"
);
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

test("typing diagnostics record timing and counts without draft text", () => {
  assert.match(composer, /"keystroke sample"/);
  assert.match(composer, /inputDelayMs/);
  assert.match(composer, /paintDelayMs/);
  assert.match(composer, /getRecentMainThreadWork/);
  assert.match(composer, /recentWorkName/);
  assert.match(composer, /recentWorkDurationMs/);
  assert.doesNotMatch(composer, /recentWork:\s*getRecentMainThreadWork/);
  assert.match(composer, /messages: state\.messages\.length/);
  assert.match(composer, /draftLength/);
  assert.doesNotMatch(composer, /draft(?:Text|Value|Body):\s*v/);
  assert.match(diagnostics, /typing_diagnostic_write/);
  assert.match(diagnostics, /browser event latency/);
  assert.match(diagnostics, /durationThreshold: 16/);
  assert.match(app, /noteUiWorkTrigger/);
  assert.match(app, /store:\$\{changed\.join/);
  assert.match(app, /typingActive: isComposerInputActive\(\)/);
  assert.match(app, /inputFocused: isComposerInputFocused\(\)/);
  assert.match(composer, /data-composer-input="true"/);
  // 在字符进入前标记输入活跃，后台同步不能等到 onChange 才开始让路。
  assert.match(composer, /onFocus=\{\(\) => markComposerInput\(\)\}/);
  assert.match(composer, /onPointerDown=\{\(\) => markComposerInput\(\)\}/);
  assert.match(
    composer,
    /onKeyDown=\{\(e\) => \{\s*markComposerInput\(\);/
  );
  assert.match(
    app,
    /function DeferredWatchers[\s\S]*?if \(isComposerInputActive\(\)\)[\s\S]*?setTimeout\(mount, 300\)/
  );
  assert.match(
    watcher,
    /const pumpIngestQueue[\s\S]*?isComposerTypingBusy\(\) \|\| hasPendingUserInput\(\)[\s\S]*?scheduleIngestPump\(\)/
  );
  assert.match(watcher, /hasPendingUserInput\(\)/);
  assert.match(watcher, /requestIdleCallback\(pumpIngestQueue/);
  // 联系人大同步被拆成上百条小批次：必须合并后一次 set，逐条入库会占满主线程卡打字
  assert.match(
    watcher,
    /const pumpIngestQueue[\s\S]*?mergedItems \+ chunkItems > 480[\s\S]*?ingest\(merged\)/
  );
  assert.match(
    watcher,
    /const pumpIngestQueue[\s\S]*?typeof deadline\.timeRemaining === "function"[\s\S]*?break/
  );
  // 输入框聚焦且近期有输入（含输入法停顿）时后台同步让路
  assert.match(
    watcher,
    /isComposerTypingBusy\(\) \|\| hasPendingUserInput\(\)/
  );
  // 大联系人快照按账号节流，减少后台突发占用主线程
  assert.match(watcher, /CONTACT_SYNC_MIN_MS = 60_000/);
  assert.match(watcher, /event\.type !== "contacts\.sync"/);
  assert.match(watcher, /items\.length <= CONTACT_SYNC_DELTA_MAX/);
  // Android Bridge 直接推送路径也走打字让路队列，禁止绕过排队直接同步 ingest
  assert.match(bridgeWatcher, /enqueueGatedIngest\(\[ev\.payload\], ingestBridgeEvents\)/);
  // 重落盘/统计重算也避开打字中的主线程
  assert.match(persist, /isComposerTypingBusy\(Date\.now\(\)\)/);
  // 大批次入库必须切块 + 块间让出主线程，禁止一次 set 跑几百条 item 占满主线程
  assert.match(ingestSlice, /const slices = sliceIngestEvents\(events\)/);
  assert.match(ingestSlice, /const runSlice = \(sliceEvents: BridgeEvent\[\]\) =>/);
  assert.match(ingestSlice, /isComposerTypingBusy\(\)/);
  assert.match(ingestSlice, /window\.setTimeout\(step, 0\)/);
  // 只克隆会被原地改写的数组，未改动集合保持 state 引用，避免每批全量克隆
  assert.match(ingestSlice, /const touch = ingestTouchSet\(sliceEvents\)/);
  assert.match(
    ingestSlice,
    /let contacts = touch\.has\("contacts"\) \? \[\.\.\.state\.contacts\] : state\.contacts/
  );
  assert.match(
    ingestSlice,
    /let messages = touch\.has\("messages"\) \? \[\.\.\.state\.messages\] : state\.messages/
  );
});
