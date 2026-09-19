import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const dir = dirname(fileURLToPath(import.meta.url));
const result = buildSync({
  entryPoints: [join(dir, "../src/lib/groupSenderDisplay.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  alias: { "@": join(dir, "../src") },
  loader: { ".ts": "ts", ".tsx": "tsx" },
  write: false,
});
const mod = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);

test("group sender uses prebuilt contact and member indexes", () => {
  const contacts = [
    {
      id: "c1",
      name: "Alice",
      phone: "",
      channelAddress: "237600000001@s.whatsapp.net",
      accountId: "wa-a",
      tags: [],
      stage: "new",
    },
  ];
  const members = [
    {
      jid: "123456789@lid",
      pnJid: "237600000001@s.whatsapp.net",
      phoneE164: "+237600000001",
      name: "Member",
    },
  ];
  const contactLookup = mod.buildSenderContactLookup(contacts, "wa-a");
  const memberLookup = mod.buildSenderMemberLookup(members);
  const noScanContacts = new Proxy(contacts, {
    get(target, key, receiver) {
      if (key === "filter" || key === "find") {
        throw new Error("contacts were scanned per message");
      }
      return Reflect.get(target, key, receiver);
    },
  });
  const noScanMembers = new Proxy(members, {
    get(target, key, receiver) {
      if (key === "length" || key === Symbol.iterator) {
        throw new Error("members were scanned per message");
      }
      return Reflect.get(target, key, receiver);
    },
  });

  const sender = mod.presentGroupSender(
    { senderJid: "123456789@lid", direction: "in" },
    {
      accountId: "wa-a",
      contacts: noScanContacts,
      members: noScanMembers,
      contactLookup,
      memberLookup,
    }
  );

  assert.equal(sender.label, "Alice");
  assert.equal(sender.subtitle, "+237600000001");
});
