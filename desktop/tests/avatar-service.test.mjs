import assert from "node:assert/strict";
import { createAvatarService } from "../baileys-bridge/avatarService.mjs";

const contact = {
  jid: "123@s.whatsapp.net",
  phoneE164: "+123",
  displayName: "Test",
  updatedAt: Date.now(),
};
const contacts = new Map([[contact.jid, contact]]);
const pushed = [];
const service = createAvatarService({
  contacts,
  getConnection: () => "connected",
  getSocket: () => ({ profilePictureUrl: async () => "" }),
  logger: null,
  push: (type, payload) => pushed.push({ type, payload }),
  enrichContact: async () => contact,
  contactPayload: (item) => item,
});

service.enqueueAvatar(contact.jid);
await new Promise((resolve) => setTimeout(resolve, 650));
assert.equal(pushed[0]?.type, "contacts.sync");
assert.equal(pushed[0]?.payload.items[0].jid, contact.jid);
console.log("avatar service: ok");
