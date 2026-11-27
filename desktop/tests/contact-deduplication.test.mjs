import test from "node:test";
import assert from "node:assert/strict";
import { findDuplicateContactGroups } from "../src/lib/contactDeduplication.ts";
import { buildContactDeduplicationPatch } from "../src/lib/contactDeduplicationPatch.ts";

test("findDuplicateContactGroups groups same-account duplicates and picks active chat contact as keeper", () => {
  const contacts = [
    {
      id: "c-import-1",
      name: "11/16Koumba",
      phone: "+24104128106",
      accountId: "wa-a",
      tags: ["VIP"],
      stage: "new",
      notes: "Imported from Excel",
    },
    {
      id: "bridge-contact-1",
      name: "群成员",
      phone: "24104128106",
      channelAddress: "24104128106@s.whatsapp.net",
      accountId: "wa-a",
      tags: ["WhatsApp"],
      stage: "contacted",
      notes: "Active buyer",
    },
    {
      id: "bridge-contact-other-account",
      name: "Koumba Other Account",
      phone: "+24104128106",
      accountId: "wa-b",
      tags: [],
      stage: "new",
    },
    {
      id: "group-1",
      name: "Sales Group",
      phone: "+24104128106",
      channelAddress: "120363000001@g.us",
      accountId: "wa-a",
      isGroup: true,
      tags: [],
      stage: "new",
    },
  ];
  const chats = [
    {
      id: "bridge-chat-1",
      contactId: "bridge-contact-1",
      contactName: "群成员",
      lastMessage: "Bonjour",
      unread: 1,
      updatedAt: "2026-11-23T10:00:00.000Z",
      phoneId: "wa-a",
      accountId: "wa-a",
      hasMessageHistory: true,
    },
    {
      id: "chat-c-import-1",
      contactId: "c-import-1",
      contactName: "11/16Koumba",
      lastMessage: "",
      unread: 0,
      updatedAt: "2026-11-22T10:00:00.000Z",
      phoneId: "wa-a",
      accountId: "wa-a",
      hasMessageHistory: false,
    },
  ];

  const groups = findDuplicateContactGroups({
    contacts,
    chats,
    messages: [],
    accountId: "wa-a",
    liveAccountId: "wa-a",
  });

  assert.equal(groups.length, 1);
  assert.equal(groups[0].normalizedPhone, "+24104128106");
  assert.equal(groups[0].keeper.id, "bridge-contact-1");
  assert.deepEqual(
    groups[0].duplicates.map((item) => item.id),
    ["c-import-1"]
  );
});

test("buildContactDeduplicationPatch merges fields, prunes empty shell chats, and remaps all references", () => {
  const contacts = [
    {
      id: "bridge-contact-1",
      name: "群成员",
      phone: "24104128106",
      channelAddress: "24104128106@s.whatsapp.net",
      accountId: "wa-a",
      tags: ["WhatsApp"],
      stage: "contacted",
      notes: "Active buyer",
    },
    {
      id: "c-import-1",
      name: "11/16Koumba",
      phone: "+24104128106",
      accountId: "wa-a",
      company: "Libreville Trading",
      tags: ["VIP", "WhatsApp"],
      stage: "new",
      notes: "Imported from Excel",
    },
  ];
  const chats = [
    {
      id: "bridge-chat-1",
      contactId: "bridge-contact-1",
      contactName: "群成员",
      lastMessage: "Bonjour",
      unread: 1,
      updatedAt: "2026-11-23T10:00:00.000Z",
      phoneId: "wa-a",
      accountId: "wa-a",
      hasMessageHistory: true,
    },
    {
      id: "chat-c-import-1",
      contactId: "c-import-1",
      contactName: "11/16Koumba",
      lastMessage: "",
      unread: 0,
      updatedAt: "2026-11-22T10:00:00.000Z",
      phoneId: "wa-a",
      accountId: "wa-a",
      hasMessageHistory: false,
    },
  ];

  const groups = findDuplicateContactGroups({
    contacts,
    chats,
    messages: [],
    accountId: "wa-a",
    liveAccountId: "wa-a",
  });

  const patch = buildContactDeduplicationPatch(
    {
      contacts,
      chats,
      messages: [
        {
          id: "msg-1",
          chatId: "bridge-chat-1",
          contactId: "c-import-1",
          direction: "in",
          body: "Hello",
          sentAt: "2026-11-23T10:00:00.000Z",
        },
      ],
      followUps: [
        {
          id: "fu-1",
          contactId: "c-import-1",
          contactName: "11/16Koumba",
          dueAt: "2026-11-25",
          note: "Call back",
          done: false,
        },
      ],
      activities: [
        {
          id: "act-1",
          contactId: "c-import-1",
          kind: "note",
          title: "Imported",
          at: "2026-11-22T10:00:00.000Z",
        },
      ],
      broadcastCampaigns: [
        {
          id: "bc-1",
          items: [
            { id: "bi-1", contactId: "c-import-1", contactName: "11/16Koumba" },
            { id: "bi-2", contactId: "bridge-contact-1", contactName: "群成员" },
          ],
        },
      ],
      scheduledMessages: [
        {
          id: "sm-1",
          chatId: "bridge-chat-1",
          contactId: "c-import-1",
          contactName: "11/16Koumba",
          recipient: "+24104128106",
          text: "Reminder",
          dueAt: "2026-11-25T10:00:00.000Z",
          channelId: "baileys",
          status: "pending",
          createdAt: "2026-11-23T10:00:00.000Z",
        },
      ],
      selectedContactId: "c-import-1",
      selectedChatId: "chat-c-import-1",
    },
    groups
  );

  assert.equal(patch.summary.groupsMerged, 1);
  assert.equal(patch.summary.removedContacts, 1);
  assert.equal(patch.summary.removedEmptyChats, 1);
  assert.equal(patch.contacts.length, 1);
  assert.equal(patch.contacts[0].id, "bridge-contact-1");
  assert.equal(patch.contacts[0].name, "11/16Koumba");
  assert.equal(patch.contacts[0].company, "Libreville Trading");
  assert.deepEqual(patch.contacts[0].tags, ["WhatsApp", "VIP"]);
  assert.match(patch.contacts[0].notes || "", /Active buyer/);
  assert.match(patch.contacts[0].notes || "", /Imported from Excel/);
  assert.equal(patch.chats.length, 1);
  assert.equal(patch.chats[0].contactName, "11/16Koumba");
  assert.equal(patch.messages[0].contactId, "bridge-contact-1");
  assert.equal(patch.followUps[0].contactId, "bridge-contact-1");
  assert.equal(patch.activities[0].contactId, "bridge-contact-1");
  assert.deepEqual(
    patch.broadcastCampaigns[0].items.map((item) => item.contactId),
    ["bridge-contact-1", "bridge-contact-1"]
  );
  assert.equal(patch.broadcastCampaigns[0].items[0].contactName, "11/16Koumba");
  assert.equal(patch.scheduledMessages[0].contactId, "bridge-contact-1");
  assert.equal(patch.selectedContactId, "bridge-contact-1");
  assert.equal(patch.selectedChatId, "bridge-chat-1");
});

test("buildContactDeduplicationPatch never deletes duplicate chats that have message history", () => {
  const contacts = [
    {
      id: "bridge-contact-1",
      name: "Alice",
      phone: "+243810000001",
      accountId: "wa-a",
      tags: [],
      stage: "new",
    },
    {
      id: "c-import-2",
      name: "Alice Old",
      phone: "+243810000001",
      accountId: "wa-a",
      tags: [],
      stage: "new",
    },
  ];
  const chats = [
    {
      id: "bridge-chat-1",
      contactId: "bridge-contact-1",
      contactName: "Alice",
      lastMessage: "Recent",
      unread: 0,
      updatedAt: "2026-11-23T12:00:00.000Z",
      phoneId: "wa-a",
      accountId: "wa-a",
      hasMessageHistory: true,
    },
    {
      id: "chat-c-import-2",
      contactId: "c-import-2",
      contactName: "Alice Old",
      lastMessage: "Old history",
      unread: 0,
      updatedAt: "2026-11-20T12:00:00.000Z",
      phoneId: "wa-a",
      accountId: "wa-a",
      hasMessageHistory: true,
    },
  ];

  const groups = findDuplicateContactGroups({
    contacts,
    chats,
    messages: [],
    accountId: "wa-a",
    liveAccountId: "wa-a",
  });
  const patch = buildContactDeduplicationPatch(
    {
      contacts,
      chats,
      messages: [],
      followUps: [],
      activities: [],
      broadcastCampaigns: [],
      scheduledMessages: [],
      selectedContactId: null,
      selectedChatId: null,
    },
    groups
  );

  assert.equal(patch.summary.removedEmptyChats, 0);
  assert.equal(patch.chats.length, 2);
  assert.deepEqual(
    patch.chats.map((chat) => chat.contactId),
    ["bridge-contact-1", "bridge-contact-1"]
  );
});
