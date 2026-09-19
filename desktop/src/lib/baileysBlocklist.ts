import { request as baileysHttp } from "./baileys";

export type BlocklistResponse = {
  ok: boolean;
  jids?: string[];
  jid?: string;
  action?: string;
  error?: string;
  code?: string;
};

export function baileysBlocklist(accountId?: string | null, refresh = false) {
  const q = refresh ? "?refresh=1" : "";
  return baileysHttp<BlocklistResponse>(`/blocklist${q}`, { method: "GET" }, accountId);
}

export function baileysBlocklistSet(
  jidOrPhone: string,
  action: "block" | "unblock",
  accountId?: string | null
) {
  return baileysHttp<BlocklistResponse>(
    "/blocklist",
    {
      method: "POST",
      body: JSON.stringify({ jid: jidOrPhone, phoneE164: jidOrPhone, action }),
    },
    accountId
  );
}
