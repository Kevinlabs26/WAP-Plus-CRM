import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../src/components/crm/CrmAiPanel.tsx", import.meta.url),
  "utf8"
);

assert.match(source, /useAppStore\.setState\(\{ aiSuggestions: \[\] \}\)/);
assert.match(source, /const suggestionKey = useMemo[\s\S]*?getSuggestionContextKey\(contact, thread, settings, aiAccountId\)/);
assert.match(source, /useLayoutEffect\([\s\S]*?\[selectedChatId, selectedContactId, setCrmPanelCollapsed\]/);
assert.match(source, /\}, \[selectedChatId, selectedContactId\]\)/);
assert.match(source, /const request = \+\+generation\.current/);
assert.match(source, /suggestionCache/);
assert.match(source, /window\.setTimeout\(\(\) =>/);
assert.match(source, /latestSuggestionKey\.current !== key/);
assert.match(source, /requestSuggestions\(key\)/);
assert.match(source, /\[\s*collapsed,\s*panelTab,\s*suggestionKey,\s*aiReady,\s*awaitingReply,\s*\]/);

console.log("ai-panel-refresh.test.mjs ok");
