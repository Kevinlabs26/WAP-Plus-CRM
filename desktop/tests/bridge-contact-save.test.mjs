import assert from "node:assert/strict";
import { summarizePhoneContactSaveStatuses } from "../src/lib/bridge.ts";

assert.deepEqual(
  summarizePhoneContactSaveStatuses(
    [{ status: "saved" }, { status: "exists" }, { status: "failed" }],
    4
  ),
  { saved: 1, exists: 1, failed: 2 }
);

console.log("bridge contact save summary: ok");
