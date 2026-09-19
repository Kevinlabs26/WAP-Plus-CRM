import type { SalesStage } from "@/types/crm";

export const SALES_STAGES: { id: SalesStage; label: string }[] = [
  { id: "new", label: "新客户" },
  { id: "contacted", label: "已联系" },
  { id: "quoting", label: "报价中" },
  { id: "won", label: "成交" },
  { id: "after_sales", label: "售后" },
];

export const SALES_STAGE_LABEL = Object.fromEntries(
  SALES_STAGES.map(({ id, label }) => [id, label])
) as Record<SalesStage, string>;

/** 合并用户自定义阶段名（settings.salesStageLabels） */
export function resolveSalesStageLabel(
  stage: SalesStage,
  overrides?: Partial<Record<SalesStage, string>> | null
): string {
  const custom = (overrides?.[stage] || "").trim();
  return custom || SALES_STAGE_LABEL[stage] || stage;
}

export function salesStagesWithLabels(
  overrides?: Partial<Record<SalesStage, string>> | null,
  order?: SalesStage[] | null
): { id: SalesStage; label: string }[] {
  const ids = order?.length ? [...new Set(order)] : SALES_STAGES.map((s) => s.id);
  return ids.map((id) => ({ id, label: resolveSalesStageLabel(id, overrides) }));
}

export function workflowForStage(stage: SalesStage) {
  if (stage === "won") {
    return {
      followUpTitle: "跟进计划",
      emptyFollowUp: "成交后建议约定交付/回款提醒，避免漏跟",
      tomorrowLabel: "设为明天",
      tomorrowNote: "交付与回款确认",
      nextAction: "确认交付、回款和客户验收",
    };
  }
  if (stage === "after_sales") {
    return {
      followUpTitle: "跟进计划",
      emptyFollowUp: "可设售后回访或复购提醒",
      tomorrowLabel: "设为明天",
      tomorrowNote: "售后回访",
      nextAction: "确认问题处理结果并寻找复购机会",
    };
  }
  return {
    followUpTitle: "跟进计划",
    emptyFollowUp: "还没有下次跟进时间，可快速设明天或自选日期时间",
    tomorrowLabel: "明天 10:00",
    tomorrowNote:
      stage === "quoting" ? "跟进报价反馈" : "跟进需求确认",
    nextAction:
      stage === "quoting"
        ? "确认报价反馈并推动成交"
        : "确认客户需求并安排下一步沟通",
  };
}
