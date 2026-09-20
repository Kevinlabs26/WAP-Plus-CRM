import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const catalog = await readFile(
  new URL("../src/components/chat/useCatalog.ts", import.meta.url),
  "utf8"
);
const product = await readFile(
  new URL("../src/components/chat/sendProductMessage.ts", import.meta.url),
  "utf8"
);
const panel = await readFile(
  new URL("../src/components/chat/ChatPanel.tsx", import.meta.url),
  "utf8"
);
const multiWindowCard = await readFile(
  new URL("../src/features/multiWindow/components/MultiWindowCard.tsx", import.meta.url),
  "utf8"
);
const latestEditable = await readFile(
  new URL("../src/components/chat/latestEditableMessage.ts", import.meta.url),
  "utf8"
);

assert.match(catalog, /if \(!opts\.isBaileys\)/);
assert.match(product, /if \(channelId !== "baileys"\)/);
assert.match(
  panel,
  /if \(!isBaileys\) \{[\s\S]*?当前通道不支持联系人名片/
);
assert.match(panel, /resolveWaSendAccountId\([\s\S]*?requestedChatAccountId/);
assert.match(multiWindowCard, /resolveWaSendAccountId\([\s\S]*?requestedChatAccountId/);
assert.match(latestEditable, /message\.direction === "out"/);
assert.match(latestEditable, /!message\.mediaType/);
assert.match(panel, /onEditLatest=\{editLatestMessage\}/);
assert.match(multiWindowCard, /onEditLatest=\{editLatestMessage\}/);

const toggleBlock = await readFile(
  new URL("../src/components/chat/toggleBlockAction.ts", import.meta.url),
  "utf8"
);
assert.match(toggleBlock, /if \(!connected\)[\s\S]*?账号未连接/);

console.log("channel-capability-guards.test.mjs ok");
