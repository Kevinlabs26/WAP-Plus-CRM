import { useI18n } from "@/i18n";
import type { AiDecisionDetails } from "@/lib/aiDecisionDetails";

export function AiDecisionDetailsView({ details, showMuse = true }: { details?: AiDecisionDetails; showMuse?: boolean }) {
  const { t } = useI18n();
  if (!details) return null;
  const muse = details.museAccountName || details.museAccountId;
  return <div className="space-y-1 break-words text-xs text-zinc-500">
    {details.playbookName && <p>{t("aiTasks.playbookUsed", { name: details.playbookName })}{details.playbookVersion && <>
      {" · "}<span title={details.playbookVersion}>{t("aiTasks.playbookVersion", { version: details.playbookVersion.slice(0, 12) })}</span>
    </>}</p>}
    {showMuse && muse && <p>{t("aiTasks.replyMuse", { name: muse })}</p>}
    {details.reason && <p>{t("aiTasks.decisionReason", { reason: details.reason })}</p>}
    {details.evidence && <p>{t("aiTasks.decisionEvidence", { evidence: details.evidence })}</p>}
  </div>;
}
