import assert from "node:assert/strict";
import test from "node:test";
import { diffMessageRows } from "../src/store/messagePersistDelta.ts";

test("message persistence only submits new or changed rows", () => {
  const unchanged = { id: "same", body: "same" };
  const beforeChanged = { id: "changed", body: "old" };
  const afterChanged = { id: "changed", body: "new" };
  const added = { id: "new", body: "new" };

  assert.deepEqual(
    diffMessageRows(
      [unchanged, beforeChanged, { id: "deleted", body: "old" }],
      [unchanged, afterChanged, added]
    ),
    {
      changedRows: [afterChanged, added],
      deletedIds: ["deleted"],
    }
  );
});
