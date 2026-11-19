import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../src/components/crm/CrmAiPanel.tsx", import.meta.url),
  "utf8"
);

assert.match(source, /useAppStore\.setState\(\{ aiSuggestions: cached\?\.result\?\.suggestions \|\| \[\] \}\)/);
assert.match(source, /const suggestionKey = useMemo[\s\S]*?getSuggestionContextKey\(contact, thread, settings, aiAccountId, \{ chatId: selectedChatId \|\| undefined,\s*count:1 \}\)/);
assert.match(source, /useLayoutEffect\([\s\S]*?\[selectedChatId, selectedContactId, setCrmPanelCollapsed\]/);
assert.match(source, /\}, \[selectedChatId, selectedContactId\]\)/);
assert.match(source, /const request = \+\+generation\.current/);
assert.match(source, /suggestionCache/);
assert.match(source, /latestSuggestionKey\.current !== key/);
assert.match(source, /suggestionCache\.request\(key,[\s\S]*?true, showProgress\(key, request\)/);
assert.doesNotMatch(source, /useEffect\(\(\) => \{[^}]*?generateSuggestions\(/);

console.log("ai-panel-refresh.test.mjs ok");
