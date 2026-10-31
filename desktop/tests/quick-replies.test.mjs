import test from "node:test";
import assert from "node:assert/strict";
import {
  filterQuickReplies,
  normalizeQuickReplyCategory,
} from "../src/lib/quickReplies.ts";

test("legacy quick replies infer useful categories", () => {
  assert.equal(normalizeQuickReplyCategory(undefined, "打招呼"), "opening");
  assert.equal(normalizeQuickReplyCategory(undefined, "索要需求", "请发型号和数量，我来报价"), "quote");
  assert.equal(normalizeQuickReplyCategory(undefined, "跟进确认"), "follow-up");
  assert.equal(normalizeQuickReplyCategory("after-sales", "物流查询"), "after-sales");
});

test("quick replies filter by category and title or body", () => {
  const items = [
    { title: "打招呼", body: "您好", category: "opening" },
    { title: "报价", body: "请提供目的港", category: "quote" },
    { title: "跟进", body: "方案看了吗", category: "follow-up" },
  ];
  assert.deepEqual(
    filterQuickReplies(items, "quote", "目的港").map((item) => item.title),
    ["报价"]
  );
  assert.deepEqual(
    filterQuickReplies(items, "all", "方案").map((item) => item.title),
    ["跟进"]
  );
});

test("custom quick-reply categories are accepted", () => {
  assert.equal(
    normalizeQuickReplyCategory("custom-sales", "", "", [
      { id: "custom-sales", label: "销售" },
    ]),
    "custom-sales"
  );
});

test("search matches all words across fields, ignoring case and French accents", () => {
  const items = [
    {title:"Réunion Église",body:"Vendredi à 19h",category:"opening",media:{fileName:"présentation.pdf"}},
    {title:"Réunion",body:"Lundi",category:"other"},
    {title:"中文问候",body:"早上好",category:"opening"},
  ];
  for (const query of ["  EGLISE\t REUNION  ","vendredi présentation","re\u0301union 19h"]) {
    assert.deepEqual(filterQuickReplies(items,"all",query),[items[0]]);
  }
  assert.deepEqual(filterQuickReplies(items,"all","réunion absent"),[]);
  assert.deepEqual(filterQuickReplies(items,"other","reunion vendredi"),[]);
  assert.deepEqual(filterQuickReplies(items,"all","中文 早上"),[items[2]]);
  assert.deepEqual(filterQuickReplies(items,"all"," \n\t"),items);
});
