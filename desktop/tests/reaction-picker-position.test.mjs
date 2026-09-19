import assert from "node:assert/strict";
import { placeReactionPicker } from "../src/components/chat/reactionPickerPosition.ts";

assert.deepEqual(
  placeReactionPicker(
    { left: 100, right: 130, bottom: 500 },
    { width: 1200, height: 800 }
  ),
  { left: 138, top: 128 }
);
assert.deepEqual(
  placeReactionPicker(
    { left: 900, right: 930, bottom: 200 },
    { width: 1000, height: 600 }
  ),
  { left: 540, top: 8 }
);

console.log("reaction picker position: ok");
