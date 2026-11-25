export const AI_BLOCKED_TERMS_MAX_LENGTH = 4000;
const AI_BLOCKED_TERMS_MAX_COUNT = 100;
const AI_PRIVACY_REDACTION = "[REDACTED LOCALLY]";
type AiPrivacyPolicy = { terms: string; redaction?: string };
let readPolicy: (() => AiPrivacyPolicy) | undefined;

export function setAiPrivacyPolicyProvider(provider: typeof readPolicy) {
  readPolicy = provider;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const normalize = (text: string) => text.normalize("NFKD").toLowerCase().replace(/ς/g, "σ");

export function redactAiContent(text: string | undefined): string | undefined {
  if (typeof text !== "string") return text;
  const policy = readPolicy?.();
  const terms = policy?.terms;
  if (!terms) return text;
  const patterns = [...new Set(terms.slice(0, AI_BLOCKED_TERMS_MAX_LENGTH).split(/\r?\n/)
    .map(term => term.trim()).filter(Boolean).slice(0, AI_BLOCKED_TERMS_MAX_COUNT)
    .flatMap(term => [normalize(term), normalize(JSON.stringify(term).slice(1, -1))]))]
    .filter(Boolean).sort((a, b) => b.length - a.length);
  if (!patterns.length) return text;

  const sourceRanges: { start: number; end: number }[] = [];
  const normalized: string[] = [];
  for (const { segment, index: start } of graphemes.segment(text)) {
    const value = normalize(segment);
    normalized.push(value);
    for (let index = 0; index < value.length; index++) sourceRanges.push({ start, end: start + segment.length });
  }
  const content = normalized.join("");
  const matched = new Uint8Array(content.length);
  for (const pattern of patterns) {
    for (let from = 0, index = content.indexOf(pattern); index >= 0; index = content.indexOf(pattern, from)) {
      matched.fill(1, index, index + pattern.length);
      from = index + 1;
    }
  }

  const ranges: { start: number; end: number }[] = [];
  for (let index = 0; index < matched.length; index++) {
    if (!matched[index]) continue;
    const source = sourceRanges[index];
    if (!source) continue;
    const previous = ranges.at(-1);
    if (previous && source.start <= previous.end) previous.end = Math.max(previous.end, source.end);
    else ranges.push({ ...source });
  }
  let output = text;
  for (const range of ranges.reverse()) {
    output = output.slice(0, range.start) + (policy?.redaction || AI_PRIVACY_REDACTION) + output.slice(range.end);
  }
  return output;
}

export function checkAiMessages<T extends { content: string }[]>(messages: T): T {
  return messages.map(message => ({ ...message, content: redactAiContent(message.content) ?? "" })) as T;
}
