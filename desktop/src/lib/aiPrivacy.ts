export const AI_BLOCKED_TERMS_MAX_LENGTH = 4000;
const AI_BLOCKED_TERMS_MAX_COUNT = 100;
let readPolicy: (() => { terms: string; blockedMessage: string }) | undefined;

export function setAiPrivacyPolicyProvider(provider: typeof readPolicy) {
  readPolicy = provider;
}

export function assertAiContentAllowed(...texts: (string | undefined)[]) {
  const policy = readPolicy?.();
  if (!policy?.terms) return;
  const normalize = (text: string) => text.normalize("NFKC").toLowerCase();
  const terms = policy.terms.slice(0, AI_BLOCKED_TERMS_MAX_LENGTH).split(/\r?\n/)
    .map(term => normalize(term.trim())).filter(Boolean).slice(0, AI_BLOCKED_TERMS_MAX_COUNT);
  if (!terms.length) return;
  // Some prompts embed conversation text as JSON.
  const patterns = terms.flatMap(term => [term, JSON.stringify(term).slice(1, -1)]);
  if (texts.some(text => {
    const content = normalize(text || "");
    return patterns.some(term => content.includes(term));
  })) {
    throw new Error(policy.blockedMessage);
  }
}

export function checkAiMessages<T extends { content: string }[]>(messages: T): T {
  assertAiContentAllowed(...messages.map(message => message.content));
  return messages;
}
