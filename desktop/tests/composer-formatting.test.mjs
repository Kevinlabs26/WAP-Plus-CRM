import test from "node:test";
import assert from "node:assert/strict";
import { toggleComposerBold } from "../src/lib/composerFormatting.ts";

test("bold wraps selected text and keeps it selected", () => {
  assert.deepEqual(toggleComposerBold("hello world", 6, 11), {
    value: "hello *world*",
    selectionStart: 7,
    selectionEnd: 12,
  });
});

test("bold inserts a pair and places the caret between markers", () => {
  assert.deepEqual(toggleComposerBold("hello", 5, 5), {
    value: "hello**",
    selectionStart: 6,
    selectionEnd: 6,
  });
});

test("bold toggles off for text already wrapped by markers", () => {
  assert.deepEqual(toggleComposerBold("hello *world*", 7, 12), {
    value: "hello world",
    selectionStart: 6,
    selectionEnd: 11,
  });
});
