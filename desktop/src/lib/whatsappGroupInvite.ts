const INVITE_RE =
  /(?:https?:\/\/)?(?:www\.)?chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9_-]+)/i;
const INVITES_RE =
  /(?:https?:\/\/)?(?:www\.)?chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9_-]+)/gi;

export function extractWhatsAppInvite(text: string): string {
  const match = String(text || "").match(INVITE_RE);
  return match?.[0] || "";
}

export function extractWhatsAppInvites(text: string): string[] {
  const seen = new Set<string>();
  const links: string[] = [];
  for (const match of String(text || "").matchAll(INVITES_RE)) {
    const code = match[1];
    const key = code.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(`https://chat.whatsapp.com/${code}`);
  }
  return links;
}
