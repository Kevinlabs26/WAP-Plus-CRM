import assert from "node:assert/strict";
import {
  dedupeAccountLabels,
  formatAccountDisplay,
  nextAccountLabel,
  parseAccountSlotNumber,
  reorderAccountSorts,
} from "../src/lib/accountLabels.ts";

// 槽位标签已改为纯数字（兼容旧「账号N」输入）
assert.equal(nextAccountLabel(["1", "3"]), "2");
assert.equal(nextAccountLabel(["账号1", "账号3"]), "2");
assert.equal(nextAccountLabel(["账号 1", "账号 3"]), "2");
assert.deepEqual(
  dedupeAccountLabels([
    { id: "a", label: "账号 2" },
    { id: "b", label: "账号 2" },
    { id: "c", label: "销售号" },
    { id: "d", label: "销售号" },
  ]).map(({ label }) => label),
  ["2", "3", "销售号", "销售号 (2)"]
);

assert.equal(parseAccountSlotNumber("账号 2"), 2);
assert.equal(parseAccountSlotNumber("账号3"), 3);
assert.equal(parseAccountSlotNumber("2"), 2);
assert.equal(
  formatAccountDisplay({ label: "1", userName: "Bailey", index1: 1 }),
  "1: Bailey"
);
assert.equal(
  formatAccountDisplay({ label: "2", userName: null, index1: 2 }),
  "2"
);
// 自定义名：保留自定义 label
assert.equal(
  formatAccountDisplay({ label: "销售号", userName: "Ann", index1: 3 }),
  "销售号: Ann"
);
// 排序：label 仍是「1」但列表位序是 2 → 显示 2
assert.equal(
  formatAccountDisplay({
    label: "1",
    userName: "Novainteractive",
    index1: 2,
  }),
  "2: Novainteractive"
);
assert.equal(
  formatAccountDisplay({ label: "账号1", userName: "E", index1: 2 }),
  "2: E"
);
// 名字误带冒号/空格时不出现双冒号
assert.equal(
  formatAccountDisplay({
    label: "1",
    userName: "： Novainteractive",
    index1: 1,
  }),
  "1: Novainteractive"
);
assert.equal(
  formatAccountDisplay({
    label: "1：",
    userName: "Novainteractive",
    index1: 1,
  }),
  "1: Novainteractive"
);

const reordered = reorderAccountSorts(
  [
    { id: "a", label: "1", sort: 0 },
    { id: "b", label: "2", sort: 1 },
    { id: "c", label: "3", sort: 2 },
  ],
  ["c", "a", "b"],
  true
);
assert.deepEqual(
  reordered.map((a) => ({ id: a.id, label: a.label, sort: a.sort })),
  [
    { id: "c", label: "1", sort: 0 },
    { id: "a", label: "2", sort: 1 },
    { id: "b", label: "3", sort: 2 },
  ]
);

console.log("account labels: ok");
