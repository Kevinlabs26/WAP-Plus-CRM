import assert from "node:assert/strict";
import test from "node:test";

import {
  mediaPlaceholderState,
  shouldAutoLoadMessageMedia,
  shouldRetryMediaAfterSync,
} from "../src/components/chat/messageMediaUtils.ts";

test("media placeholders distinguish loading, retry and failure", () => {
  assert.equal(mediaPlaceholderState({}, true), "loading");
  assert.equal(mediaPlaceholderState({}, false), "retry");
  assert.equal(
    mediaPlaceholderState({ mediaError: "raw message missing" }, false),
    "failed"
  );
  assert.equal(
    mediaPlaceholderState({ mediaUrl: "data:audio/ogg;base64,x", mediaError: "old" }, false),
    "retry"
  );
});

test("media reload only resyncs for a missing bridge message", () => {
  assert.equal(shouldRetryMediaAfterSync({ status: 404 }), true);
  assert.equal(shouldRetryMediaAfterSync({ status: 500 }), false);
  assert.equal(shouldRetryMediaAfterSync(new Error("network error")), false);
});

test("visible voice messages auto-load even from older persisted snapshots", () => {
  assert.equal(
    shouldAutoLoadMessageMedia({ mediaType: "audio", mediaPending: true }),
    true
  );
  assert.equal(
    shouldAutoLoadMessageMedia({ mediaType: "audio", mediaPending: undefined }),
    true
  );
  assert.equal(
    shouldAutoLoadMessageMedia({
      mediaType: "audio",
      mediaPending: true,
      mediaUrl: "data:audio/ogg;base64,cached",
    }),
    false
  );
});

test("non-visible-prefetch media stays manual", () => {
  assert.equal(
    shouldAutoLoadMessageMedia({ mediaType: "video", mediaPending: true }),
    false
  );
  assert.equal(
    shouldAutoLoadMessageMedia({ mediaType: "image", mediaPending: false }),
    false
  );
});
