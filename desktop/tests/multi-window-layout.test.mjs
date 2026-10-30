import test from "node:test";
import assert from "node:assert/strict";
import { multiWindowGridClass } from "../src/features/multiWindow/lib/layout.ts";

test("one-column layout keeps a stable card height", () => {
  const classes = multiWindowGridClass("one", false);
  assert.match(classes, /grid-cols-1/);
  assert.match(classes, /data-collapsed=true/);
  assert.match(classes, /h-\[26rem\]/);
});

test("two-column compact layout uses a smaller stable card height", () => {
  const classes = multiWindowGridClass("two", true);
  assert.match(classes, /lg:grid-cols-2/);
  assert.match(classes, /data-collapsed=true/);
  assert.match(classes, /h-\[20rem\]/);
});

test("auto layout follows available width without forcing empty rows", () => {
 const classes = multiWindowGridClass("auto", false);
 assert.match(classes, /auto-fit/);
 assert.doesNotMatch(classes, /h-full|grid-rows/);
 assert.match(classes, /26rem/);
});
