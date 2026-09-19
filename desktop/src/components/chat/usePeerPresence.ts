import { useMemo } from "react";
import { useAppStore } from "@/store/appStore";
import type { Contact } from "@/types/crm";

export type PeerPresenceHit = {
  presence: string;
  at: number;
  lastSeen?: number;
  onlineAt?: number;
  jid?: string;
};

export type PeerPresenceCoresOpts = {
  chatId?: string | null;
  contactId?: string | null;
  channelAddress?: string | null;
  phone?: string | null;
};

function dig(s?: string) {
  return (s || "").replace(/\D/g, "");
}

function jidUser(s: string) {
  const t = s.trim();
  if (!t) return "";
  const noDevice = t.replace(/:\d+@/, "@");
  return noDevice.includes("@") ? noDevice.split("@")[0] : noDevice;
}

export function formatLastSeen(ms?: number): string | null {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  const hm = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (sameDay) return `最后在线今天 ${hm}`;
  if (isYday) return `最后在线昨天 ${hm}`;
  const day = d.toLocaleDateString(undefined, {
    month: "numeric",
    day: "numeric",
  });
  return `最后在线 ${day} ${hm}`;
}

/** 精确查找键：禁止短数字、禁止互相 includes */
export function peerPresenceCores(opts: PeerPresenceCoresOpts): Set<string> {
  const phoneDig = dig(opts.phone || undefined);
  const keys: string[] = [];
  const add = (k?: string | null) => {
    if (!k) return;
    const s = String(k).trim();
    if (!s) return;
    if (/^\d{1,6}$/.test(s)) return;
    keys.push(s);
    keys.push(s.toLowerCase());
  };
  add(opts.chatId);
  add(opts.contactId);
  add(opts.channelAddress);
  if (opts.channelAddress) {
    add(opts.channelAddress.replace(/:\d+@/, "@"));
    add(jidUser(opts.channelAddress));
  }
  add(opts.phone);
  if (phoneDig.length >= 7) {
    add(phoneDig);
    add(`+${phoneDig}`);
    add(`${phoneDig}@s.whatsapp.net`);
  }
  if (opts.contactId) add(`bridge-chat-${opts.contactId}`);
  return new Set(keys);
}

export function isPeerOnline(hit: PeerPresenceHit | null | undefined): boolean {
  if (!hit) return false;
  if (hit.presence === "composing" || hit.presence === "recording") return true;
  if (hit.presence === "available") {
    const t = hit.onlineAt || hit.at;
    // 与写入侧一致：90s 无刷新则不当在线
    return Date.now() - t < 90_000;
  }
  return false;
}

export function peerStatusLine(hit: PeerPresenceHit | null | undefined): {
  text: string | null;
  tone: "typing" | "online" | "muted";
} {
  if (!hit) return { text: null, tone: "muted" };
  if (hit.presence === "composing")
    return { text: "正在输入…", tone: "typing" };
  if (hit.presence === "recording")
    return { text: "正在录音…", tone: "typing" };
  if (hit.presence === "available" && isPeerOnline(hit)) {
    return { text: "在线", tone: "online" };
  }
  const ls = formatLastSeen(hit.lastSeen);
  if (ls) return { text: ls, tone: "muted" };
  return { text: null, tone: "muted" };
}

export function pickPeerPresence(
  peerPresenceByKey: Record<string, PeerPresenceHit | undefined>,
  cores: Set<string>
): PeerPresenceHit | null {
  if (!cores.size) return null;
  const now = Date.now();
  let best: PeerPresenceHit | null = null;

  const consider = (p: PeerPresenceHit | undefined) => {
    if (!p) return;
    if (p.presence === "composing" || p.presence === "recording") {
      if (now - p.at > 15_000) return;
    } else if (p.presence === "available") {
      if (now - (p.onlineAt || p.at) > 90_000) return;
    } else if (p.presence === "unavailable") {
      if (!p.lastSeen && now - p.at > 3600_000) return;
    } else return;

    // 输入态优先于普通在线
    if (p.presence === "composing" || p.presence === "recording") {
      if (
        !best ||
        (best.presence !== "composing" && best.presence !== "recording") ||
        p.at >= best.at
      ) {
        best = p;
      }
      return;
    }
    if (best && (best.presence === "composing" || best.presence === "recording"))
      return;
    if (!best || p.at > best.at) best = p;
  };

  // 只查精确 key，禁止全表 includes 扫描（会把 A 的状态匹配到 B）
  for (const k of cores) {
    consider(peerPresenceByKey[k]);
    if (k !== k.toLowerCase()) consider(peerPresenceByKey[k.toLowerCase()]);
  }
  return best;
}

/**
 * 当前会话对方的 presence：绿点 / 正在输入 / 最后在线。
 */
export function usePeerPresence(opts: {
  enabled: boolean;
  chatId?: string | null;
  contact?: Contact | null;
}) {
  const cores = useMemo(
    () =>
      peerPresenceCores({
        chatId: opts.chatId,
        contactId: opts.contact?.id,
        channelAddress: opts.contact?.channelAddress,
        phone: opts.contact?.phone,
      }),
    [
      opts.chatId,
      opts.contact?.id,
      opts.contact?.channelAddress,
      opts.contact?.phone,
    ]
  );

  // 窄订阅：selector 只返回当前会话相关键的命中（引用稳定时 zustand 不重渲染），
  // 避免任一联系人 presence 更新都重渲染 ChatPanel/Header
  const activeHit = useAppStore((s) => {
    if (!opts.enabled || !opts.chatId) return null;
    return pickPeerPresence(s.peerPresenceByKey, cores);
  });

  const typingLabel = useMemo(() => {
    const line = peerStatusLine(activeHit);
    if (line.tone === "typing") return line.text;
    return null;
  }, [activeHit]);

  const subtitle = useMemo(() => {
    if (typingLabel) return typingLabel;
    return peerStatusLine(activeHit).text;
  }, [typingLabel, activeHit]);

  const online = isPeerOnline(activeHit);

  return {
    lookup: {
      coresFor: peerPresenceCores,
      pick: (c: Set<string>) =>
        pickPeerPresence(useAppStore.getState().peerPresenceByKey, c),
      formatLastSeen,
      isOnline: isPeerOnline,
      statusLine: peerStatusLine,
    },
    activeHit,
    typingLabel,
    subtitle,
    online,
  };
}
