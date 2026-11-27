export type AiDecisionDetails = {
  playbookName?: string;
  playbookVersion?: string;
  museAccountId?: string;
  museAccountName?: string;
  reason?: string;
  evidence?: string;
};

export function normalizeAiDecisionDetails(raw: unknown): AiDecisionDetails | undefined {
  if (!raw || typeof raw !== "object") return;
  const value = raw as AiDecisionDetails;
  const clean: AiDecisionDetails = {};
  for (const key of ["playbookName", "playbookVersion", "museAccountId", "museAccountName", "reason", "evidence"] as const) {
    if (typeof value[key] === "string" && value[key].trim()) clean[key] = value[key].trim().slice(0, 500);
  }
  return Object.keys(clean).length ? clean : undefined;
}
