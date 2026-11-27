import type { Contact, Message } from "../types/crm.ts";

export type ParsedOutreachDecision =
  | { action: "send" | "draft"; text: string; reason?: string; evidence?: string }
  | { action: "skip"; reason: string };

const PLACEHOLDER_EVIDENCE_RE = /^\[(?:[^\]]* omitted|voice[^\]]*)\]$/i;

function normalizeMatchText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Collect verifiable text snippets from chat history and CRM metadata for non-Muse outreach grounding. */
export function collectNonMuseOutreachSources(
  contact: Contact | undefined,
  messages: readonly Message[],
): { conversationSources: string[]; fallbackSources: string[] } {
  const conversationSources: string[] = [];
  for (const message of messages) {
    for (const candidate of [message.transcript, message.body, message.mediaCaption]) {
      const trimmed = (candidate || "").trim();
      if (trimmed && !PLACEHOLDER_EVIDENCE_RE.test(trimmed)) {
        conversationSources.push(trimmed);
      }
    }
  }

  const fallbackSources: string[] = [];
  if (contact) {
    for (const field of [
      contact.name,
      contact.company,
      contact.notes,
      contact.aiSummary,
      contact.aiIntent,
      contact.aiNextStep,
      ...(contact.tags || []),
    ]) {
      const trimmed = (field || "").trim();
      if (trimmed) fallbackSources.push(trimmed);
    }
  }
  return { conversationSources, fallbackSources };
}

/** Verify whether the model-cited evidence is grounded in actual conversation/CRM data or first-contact rule context. */
export function isNonMuseOutreachEvidenceGrounded(
  evidence: string | undefined,
  sources: { conversationSources: string[]; fallbackSources: string[] }
): boolean {
  const trimmed = (evidence || "").trim();
  if (!trimmed || PLACEHOLDER_EVIDENCE_RE.test(trimmed)) return false;
  const normalizedEvidence = normalizeMatchText(trimmed);
  if (!normalizedEvidence) return false;

  const allSources = [...sources.conversationSources, ...sources.fallbackSources];
  return allSources.some(source => normalizeMatchText(source) === normalizedEvidence);
}

/** Parse a structured outreach decision JSON payload, returning null if payload is a legacy suggestion array. */
export function tryParseStructuredOutreachDecision(
  raw: string
): ParsedOutreachDecision | null {
  let text = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(text);
  if (fence) text = fence[1]!.trim();
  const value = JSON.parse(text) as unknown;
  if (Array.isArray(value)) return null;
  if (!value || typeof value !== "object") {
    throw new Error("AI 未返回有效的主动联系决策");
  }
  const record = value as Record<string, unknown>;
  if (record.action === "skip" && typeof record.reason === "string") {
    const reason = record.reason.trim();
    if (!reason || Array.from(reason).length > 500) {
      throw new Error("AI 返回的跳过原因为空或过长");
    }
    return { action: "skip", reason };
  }
  if (
    (record.action === "send" || record.action === "draft") &&
    typeof record.text === "string"
  ) {
    const message = record.text.trim();
    if (!message || Array.from(message).length > 4000) {
      throw new Error("AI 返回的主动联系消息为空或过长");
    }
    const reason =
      typeof record.reason === "string" && Array.from(record.reason.trim()).length <= 500
        ? record.reason.trim()
        : undefined;
    const evidence =
      typeof record.evidence === "string" && Array.from(record.evidence.trim()).length <= 500
        ? record.evidence.trim()
        : undefined;
    return { action: record.action, text: message, reason, evidence };
  }
  return null;
}
