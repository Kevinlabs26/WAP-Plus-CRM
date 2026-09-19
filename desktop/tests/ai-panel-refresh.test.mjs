import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../src/components/crm/CrmAiPanel.tsx", import.meta.url),
  "utf8"
);

assert.match(source, /useAppStore\.setState\(\{ aiSuggestions: \[\] \}\)/);
assert.match(source, /const makeSuggestionKey = \(\) =>[\s\S]*?selectedChatId \|\| ""/);
assert.match(source, /useLayoutEffect\([\s\S]*?\[selectedChatId, selectedContactId, setCrmPanelCollapsed\]/);
assert.match(source, /\}, \[selectedChatId, selectedContactId\]\)/);
assert.match(source, /autoKey\.current = key;[\s\S]*?setLoading\(true\)/);
assert.match(source, /suggestionCache/);
assert.match(source, /window\.setTimeout\(\(\) =>/);
assert.match(source, /lastIn\?\.id \|\| "none"/);

console.log("ai-panel-refresh.test.mjs ok");
