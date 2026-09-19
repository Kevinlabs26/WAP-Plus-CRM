import assert from "node:assert/strict";
import test from "node:test";
import {
  applyWhatsAppLabelsToContacts,
  sameWhatsAppLabels,
} from "../src/lib/whatsappLabelSnapshot.ts";

test("unchanged WhatsApp labels skip the full contact rewrite", () => {
  const labels = [{ id: "sales", name: "Sales", color: 1 }];
  const assignments = { "123@s.whatsapp.net": ["sales"] };
  assert.equal(
    sameWhatsAppLabels(labels, assignments, [{ ...labels[0] }], {
      "123@s.whatsapp.net": ["sales"],
    }),
    true
  );
  assert.equal(
    sameWhatsAppLabels(labels, assignments, labels, {
      "123@s.whatsapp.net": [],
    }),
    false
  );
});

test("WhatsApp labels update only contacts owned by the synced account", () => {
  const contacts = [
    {
      id: "contact-a",
      accountId: "a",
      phone: "+111",
      tags: ["Local", "Old A"],
    },
    {
      id: "contact-b",
      accountId: "b",
      phone: "+222",
      tags: ["Keep B"],
    },
  ];
  const next = applyWhatsAppLabelsToContacts(
    contacts,
    "a",
    [{ id: "old", name: "Old A", color: 0 }],
    [{ id: "new", name: "New A", color: 1 }],
    { "111@s.whatsapp.net": ["new"] }
  );
  assert.deepEqual(next[0].tags, ["Local", "New A"]);
  assert.equal(next[1], contacts[1]);
});
