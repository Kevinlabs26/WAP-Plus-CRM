import assert from "node:assert/strict";
import {
  applyImportNameRule,
  detectDelimiter,
  isPlaceholderContactName,
  normalizeImportPhone,
  parseContactsImport,
  splitCsvLine,
} from "../src/lib/contactImport.ts";
import {
  buildImportExecutionPlan,
  filterImportRowsForPreview,
  resolveImportAccountDisplayName,
  selectContactsInAccountScope,
} from "../src/components/settings/contactImportModalHelpers.ts";

assert.equal(
  applyImportNameRule("Sample Contact", "+12025550123", 0, {
    prefix: "Campaign-",
    suffix: "-2026",
    fallback: "phone",
  }),
  "Campaign-Sample Contact-2026"
);
assert.equal(
  applyImportNameRule("", "+12025550123", 0, {
    prefix: "",
    suffix: "",
    fallback: "phone",
  }),
  "客户-0123"
);
assert.equal(
  applyImportNameRule(undefined, "+12025550123", 6, {
    prefix: "Campaign-",
    suffix: "",
    fallback: "sequence",
  }),
  "Campaign-客户-007"
);

// —— 分隔符检测 ——
assert.equal(detectDelimiter("a\tb\tc\n1\t2\t3"), "\t");
assert.equal(detectDelimiter('a,b,c\n1,2,3'), ",");
assert.equal(detectDelimiter("a;b;c\n1;2;3"), ";");
// 一行无逗号/分号时默认分号
assert.equal(detectDelimiter("abc"), ";");

// —— CSV 行解析（含引号转义）——
assert.deepEqual(splitCsvLine('a,"b,c",d', ","), ["a", "b,c", "d"]);
assert.deepEqual(splitCsvLine('"a""b",c', ","), ['a"b', "c"]);
assert.deepEqual(splitCsvLine("a\tb\tc", "\t"), ["a", "b", "c"]);

// —— 电话归一化 ——
assert.equal(normalizeImportPhone("12025550123"), "+12025550123");
assert.equal(normalizeImportPhone("+1 202-555-0123"), "");
assert.equal(normalizeImportPhone("12025550123"), "+12025550123");
assert.equal(normalizeImportPhone("123456789012345@lid"), "");
assert.equal(normalizeImportPhone("12025550123@s.whatsapp.net"), "+12025550123");
assert.equal(normalizeImportPhone(""), "");
assert.equal(normalizeImportPhone("not-a-phone"), "");

// —— 表头别名 + 中文字段 ——
const zh = parseContactsImport(
  "姓名,手机号,公司,备注\nSample Contact A,12025550123,Example Corp,老客户\nSample Contact B,12025550124,Demo Industries,\n",
  []
);
assert.equal(zh.hasHeader, true);
assert.equal(zh.created.length, 2);
assert.equal(zh.created[0]?.input?.name, "Sample Contact A");
assert.equal(zh.created[0]?.input?.phone, "+12025550123");
assert.equal(zh.created[0]?.input?.company, "Example Corp");
assert.equal(zh.created[0]?.input?.notes, "老客户");
assert.equal(zh.created[1]?.input?.name, "Sample Contact B");

// —— 英文表头 ——
const en = parseContactsImport(
  "name,phone,stage,tags\nSample Contact C,12025550125,quoting,Priority|Wholesale\n",
  []
);
assert.equal(en.created[0]?.input?.stage, "quoting");
assert.deepEqual(en.created[0]?.input?.tags, ["Priority", "Wholesale"]);

// —— Excel 制表符粘贴（含阶段中文）——
const excel = parseContactsImport(
  "客户名\t手机号\t阶段\nSample Contact D\t12025550126\t报价中\n",
  []
);
assert.equal(excel.detectedDelimiter, "\t");
assert.equal(excel.created.length, 1);
assert.equal(excel.created[0]?.input?.name, "Sample Contact D");
assert.equal(excel.created[0]?.input?.stage, "quoting");

// —— 去重：已存在手机号跳过 ——
const dup = parseContactsImport(
  "姓名,电话\nSample Contact A,12025550123\nSample Contact C,12025550125\n",
  [{ phone: "+12025550123" }]
);
assert.equal(dup.created.length, 1);
assert.equal(dup.created[0]?.input?.name, "Sample Contact C");
assert.equal(dup.skipped.length, 1);
assert.equal(dup.skipped[0]?.status, "skip_dup");

// —— 批内重复 ——
const inBatchDup = parseContactsImport("电话\n12025550123\n12025550123\n", []);
assert.equal(inBatchDup.created.length, 1);
assert.equal(inBatchDup.skipped.length, 1);

// —— 有电话列但行内电话为空 → 跳过 ——
const noPhone = parseContactsImport(
  "姓名,电话,公司\nSample Contact A,,Example Corp\n",
  []
);
assert.equal(noPhone.created.length, 0);
assert.equal(noPhone.skipped[0]?.status, "skip_no_phone");
assert.equal(noPhone.skipped[0]?.reason, "无有效手机号");

// —— 无表头按位置猜 ——
const positional = parseContactsImport(
  "Sample Contact A,12025550123,Example Corp\nSample Contact B,12025550124\n",
  []
);
assert.equal(positional.hasHeader, false);
assert.equal(positional.created.length, 2);
assert.equal(positional.created[0]?.input?.name, "Sample Contact A");
assert.equal(positional.created[0]?.input?.phone, "+12025550123");
assert.equal(positional.created[0]?.input?.company, "Example Corp");

// —— 单列号码无需补表头或姓名 ——
const phoneOnly = parseContactsImport("12025550123\n12025550124\n", []);
assert.equal(phoneOnly.hasHeader, false);
assert.equal(phoneOnly.created.length, 2);
assert.equal(phoneOnly.created[0]?.input?.phone, "+12025550123");

// —— 表头无电话列 → 报错 ——
const noPhoneHeader = parseContactsImport(
  "姓名,公司\nSample Contact A,Example Corp\n",
  []
);
assert.equal(noPhoneHeader.errors.length, 1);
assert.equal(noPhoneHeader.errors[0]?.status, "error");

// Placeholder contact name detection
assert.equal(isPlaceholderContactName("", "+243972816141"), true);
assert.equal(isPlaceholderContactName("群成员", "+243972816141"), true);
assert.equal(isPlaceholderContactName("+243972816141", "+243972816141"), true);
assert.equal(isPlaceholderContactName("243972816141", "+243972816141"), true);
assert.equal(isPlaceholderContactName("apot Israël", "+243972816141"), false);

// Duplicate diagnostics and execution modes (skip / fill_unnamed / overwrite)
const richDup = parseContactsImport(
  "apot Israël\t243972816141\nHélène\t237656136816\nNew Lead\t22959274995\nDup In Sheet\t22959274995\n",
  [
    { id: "c-unnamed", name: "群成员", phone: "+243972816141" },
    { id: "c-named", name: " VIP Client ", phone: "+237656136816" },
  ]
);
assert.equal(richDup.rows.length, 4);
assert.equal(richDup.created.length, 1);
assert.equal(richDup.skipped.length, 3);
assert.equal(filterImportRowsForPreview(richDup, "all").length, 4);
assert.equal(filterImportRowsForPreview(richDup, "duplicates").length, 3);

const unnamedDupRow = richDup.rows[0];
assert.equal(unnamedDupRow.duplicateSource, "existing_account");
assert.equal(unnamedDupRow.existingContactId, "c-unnamed");
assert.equal(unnamedDupRow.existingContactHasHumanName, false);

const namedDupRow = richDup.rows[1];
assert.equal(namedDupRow.duplicateSource, "existing_account");
assert.equal(namedDupRow.existingContactId, "c-named");
assert.equal(namedDupRow.existingContactHasHumanName, true);
assert.equal(richDup.rows[3]?.duplicateSource, "batch_duplicate");

const basePlanArgs = {
  importAnalysis: richDup,
  nameOverrides: {},
  nameRule: { prefix: "", suffix: "", fallback: "phone" },
  targetAccountId: "wa-mtuino4o",
  defaultSourceLabel: "Bulk import",
};
const skipPlan = buildImportExecutionPlan({ ...basePlanArgs, duplicateMode: "skip" });
assert.equal(skipPlan.contactsToCreate.length, 1);
assert.equal(skipPlan.contactsToUpdate.length, 0);

const fillPlan = buildImportExecutionPlan({ ...basePlanArgs, duplicateMode: "fill_unnamed" });
assert.equal(fillPlan.contactsToCreate.length, 1);
assert.equal(fillPlan.contactsToUpdate.length, 1);
assert.deepEqual(fillPlan.contactsToUpdate[0]?.targetContactIds, ["c-unnamed"]);
assert.equal(fillPlan.contactsToUpdate[0]?.finalName, "apot Israël");

const overwritePlan = buildImportExecutionPlan({ ...basePlanArgs, duplicateMode: "overwrite" });
assert.equal(overwritePlan.contactsToCreate.length, 1);
assert.equal(overwritePlan.contactsToUpdate.length, 2);
assert.equal(overwritePlan.cloudContacts.length, 3);

assert.equal(
  resolveImportAccountDisplayName(
    [
      { id: "wa-1", label: "1", userName: "Main", sort: 0 },
      { id: "wa-mtuino4o", label: "2", userName: "Alex", sort: 1 },
    ],
    "wa-mtuino4o"
  ),
  "2: Alex"
);

// Matching contacts with formatted phone, channelAddress-only phone, or chat-level account ownership
const scopedByChatAndFormatted = selectContactsInAccountScope(
  [
    { id: "c-chat-owner", name: "Ct CD", phone: "+243 815 760 933", accountId: "" },
    { id: "c-jid-only", name: "Old Jid", phone: "", channelAddress: "243821398377@s.whatsapp.net", boundPhoneId: "wa-mtuino4o" },
    { id: "c-other", name: "Other Acc", phone: "+22795561655", accountId: "wa-other" },
  ],
  [{ id: "chat-1", contactId: "c-chat-owner", accountId: "wa-mtuino4o" }],
  "wa-mtuino4o",
  "wa-live-1"
);
assert.deepEqual(scopedByChatAndFormatted.map((c) => c.id), ["c-chat-owner", "c-jid-only"]);
const matchedFormatted = parseContactsImport(
  "AD Christian\t243815760933\nFiston\t243821398377\n",
  scopedByChatAndFormatted
);
const matchedPlan = buildImportExecutionPlan({
  importAnalysis: matchedFormatted,
  duplicateMode: "overwrite",
  nameOverrides: {},
  nameRule: { prefix: "11/16", suffix: "", fallback: "phone" },
  targetAccountId: "wa-mtuino4o",
  defaultSourceLabel: "Bulk import",
});
assert.equal(matchedPlan.contactsToCreate.length, 0);
assert.equal(matchedPlan.contactsToUpdate.length, 2);
assert.deepEqual(matchedPlan.contactsToUpdate[0]?.targetContactIds, ["c-chat-owner"]);
assert.equal(matchedPlan.contactsToUpdate[0]?.finalName, "11/16AD Christian");
assert.deepEqual(matchedPlan.contactsToUpdate[1]?.targetContactIds, ["c-jid-only"]);
assert.equal(matchedPlan.contactsToUpdate[1]?.finalName, "11/16Fiston");

console.log("contactImport ok");
