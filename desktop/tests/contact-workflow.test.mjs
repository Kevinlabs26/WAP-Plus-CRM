import assert from "node:assert/strict";
import { salesStagesWithLabels, workflowForStage } from "../src/lib/contactWorkflow.ts";

assert.equal(workflowForStage("new").followUpTitle, "跟进计划");
assert.equal(workflowForStage("quoting").nextAction, "确认报价反馈并推动成交");
assert.equal(workflowForStage("won").tomorrowLabel, "设为明天");
assert.equal(workflowForStage("after_sales").tomorrowLabel, "设为明天");
assert.equal(workflowForStage("won").tomorrowNote, "交付与回款确认");
assert.equal(workflowForStage("after_sales").tomorrowNote, "售后回访");
assert.deepEqual(
  salesStagesWithLabels({ custom: "复购中" }, ["new", "custom"]),
  [
    { id: "new", label: "新客户" },
    { id: "custom", label: "复购中" },
  ]
);

console.log("contact workflow tests passed");
