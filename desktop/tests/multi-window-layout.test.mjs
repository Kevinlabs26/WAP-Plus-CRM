import test from "node:test";
import assert from "node:assert/strict";
import { multiWindowGridClass } from "../src/features/multiWindow/lib/layout.ts";

test("one-column layout keeps a stable card height", () => {
  const classes = multiWindowGridClass("one", false);
  assert.match(classes, /grid-cols-1/);
  assert.match(classes, /data-collapsed=true/);
  assert.match(classes, /h-\[18rem\]/);
});

test("two-column compact layout uses a smaller stable card height", () => {
  const classes = multiWindowGridClass("two", true);
  assert.match(classes, /lg:grid-cols-2/);
  assert.match(classes, /data-collapsed=true/);
  assert.match(classes, /h-\[14rem\]/);
});
