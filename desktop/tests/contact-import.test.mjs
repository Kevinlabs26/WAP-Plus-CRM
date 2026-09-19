import assert from "node:assert/strict";
import {
  applyImportNameRule,
  detectDelimiter,
  normalizeImportPhone,
  parseContactsImport,
  splitCsvLine,
} from "../src/lib/contactImport.ts";

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

console.log("contactImport ok");
