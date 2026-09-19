export function normalizeContactPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 ? `+${digits}` : "";
}

function unescapeVcardText(value) {
  return String(value || "")
    .replace(/\\n/gi, "\n")
    .replace(/\\([\\,;])/g, "$1")
    .trim();
}

export function parseContactVcard(vcard, fallbackName = "") {
  const unfolded = String(vcard || "").replace(/\r?\n[ \t]/g, "");
  const fn = unfolded.match(/^FN(?:;[^:]*)?:(.*)$/im)?.[1] || "";
  const waid = unfolded.match(/(?:^|;)waid=(\d{7,15})(?:[;:]|$)/im)?.[1];
  const tel = unfolded.match(/^TEL(?:;[^:]*)?:(.*)$/im)?.[1] || "";
  const phoneE164 = normalizeContactPhone(waid || tel);
  const displayName = unescapeVcardText(fallbackName || fn) || phoneE164;
  return { displayName, phoneE164 };
}

export function buildContactVcard(displayName, phone) {
  const phoneE164 = normalizeContactPhone(phone);
  if (!phoneE164) return null;
  const name = String(displayName || phoneE164)
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 120)
    .replace(/([\\,;])/g, "\\$1");
  const digits = phoneE164.slice(1);
  return {
    displayName: name || phoneE164,
    phoneE164,
    vcard: [
      "BEGIN:VCARD",
      "VERSION:3.0",
      `FN:${name || phoneE164}`,
      `TEL;type=CELL;type=VOICE;waid=${digits}:${phoneE164}`,
      "END:VCARD",
    ].join("\n"),
  };
}
