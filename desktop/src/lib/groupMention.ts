/**
 * 群 @mention 文本解析与插入（纯函数）。
 */

export type MentionCandidate = {
  jid: string;
  label: string;
  phoneE164?: string;
  /** 特殊：@所有人 */
  everyone?: boolean;
};

/** 光标前是否处于 @ 触发（@ 后无空格） */
export function mentionQueryAt(
  text: string,
  cursor: number
): { start: number; query: string } | null {
  const left = text.slice(0, Math.max(0, cursor));
  const m = left.match(/(^|[\s\n])@([^\s@]*)$/);
  if (!m) return null;
  const atIdx = left.lastIndexOf("@");
  if (atIdx < 0) return null;
  return { start: atIdx, query: m[2] || "" };
}

export function filterMentionCandidates(
  list: MentionCandidate[],
  query: string
): MentionCandidate[] {
  const q = query.trim().toLowerCase();
  if (!q) return list.slice(0, 40);
  return list
    .filter((c) => {
      const blob = `${c.label} ${c.phoneE164 || ""} ${c.jid}`.toLowerCase();
      return blob.includes(q);
    })
    .slice(0, 40);
}

/**
 * 把选中的 mention 写入草稿，返回新文本、光标与应带的 jid。
 * 文本里写入 @显示名（空格结尾），发送时用 mentionedJids。
 */
export function applyMentionInsert(
  text: string,
  cursor: number,
  candidate: MentionCandidate
): { text: string; cursor: number; mentionJid?: string } {
  const hit = mentionQueryAt(text, cursor);
  if (!hit) {
    const token = candidate.everyone
      ? "@所有人 "
      : `@${(candidate.label || "成员").replace(/\s+/g, "")} `;
    const next = text.slice(0, cursor) + token + text.slice(cursor);
    return {
      text: next,
      cursor: cursor + token.length,
      mentionJid: candidate.everyone ? undefined : candidate.jid,
    };
  }
  const token = candidate.everyone
    ? "@所有人 "
    : `@${(candidate.label || "成员").replace(/\s+/g, "")} `;
  const next = text.slice(0, hit.start) + token + text.slice(cursor);
  return {
    text: next,
    cursor: hit.start + token.length,
    mentionJid: candidate.everyone ? undefined : candidate.jid,
  };
}

/** 从草稿中收集仍存在的 @token 对应 jid（按插入顺序的 jids 列表过滤） */
export function resolveMentionsForSend(
  text: string,
  tracked: { token: string; jid: string; everyone?: boolean }[],
  allMemberJids: string[]
): string[] {
  const body = text || "";
  const out: string[] = [];
  let everyone = false;
  for (const t of tracked) {
    if (t.everyone || t.token.includes("所有人")) {
      if (body.includes("@所有人") || body.includes("@everyone")) everyone = true;
      continue;
    }
    if (t.token && body.includes(t.token.trim())) {
      if (t.jid && !out.includes(t.jid)) out.push(t.jid);
    }
  }
  // 兜底：正文含 @所有人
  if (
    everyone ||
    /@所有人\b/.test(body) ||
    /@everyone\b/i.test(body) ||
    /@all\b/i.test(body)
  ) {
    return [...new Set(allMemberJids.filter(Boolean))];
  }
  return out;
}
