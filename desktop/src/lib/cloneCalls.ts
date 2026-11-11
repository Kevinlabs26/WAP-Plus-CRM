import { isTauri } from "@/lib/bridge";
import { resolveSendTarget } from "@/lib/utils";
import type { WaAccount } from "@/types/account";
import type { ChatPreview, Contact } from "@/types/crm";

export type CloneApp = { appId: string; name: string };
export type CloneCallSetup = { apps: CloneApp[]; bindings: Record<string, string>; verified: Record<string, string> };
export type CloneCallTarget = { ownerPhone: string; recipientPhone: string; accountId: string; accountLabel: string };

export function isWhatsAppCallLink(raw: string): boolean {
  try {
    const url = new URL(raw);
    const token = url.pathname.slice("/voice/".length);
    return url.protocol === "https:" && url.hostname === "call.whatsapp.com" &&
      !url.username && !url.password && !url.port &&
      url.pathname.startsWith("/voice/") && /^[A-Za-z0-9_-]{1,128}$/.test(token);
  } catch {
    return false;
  }
}

export async function tryOpenBoundCallLink(
  raw: string,
  accountId: string | undefined,
  accounts: WaAccount[]
): Promise<boolean> {
  if (!isTauri() || !accountId || !isWhatsAppCallLink(raw)) return false;
  const ownerPhone = cloneCallOwnerPhone(accounts.find((account) => account.id === accountId));
  if (!ownerPhone) return false;
  try {
    const setup = await cloneCallInvoke<CloneCallSetup>("clone_call_setup", {});
    const appId = setup.bindings[ownerPhone];
    if (!appId || setup.verified?.[ownerPhone] !== appId || !setup.apps.some((app) => app.appId === appId)) return false;
    await cloneCallInvoke("clone_call_open_link", { ownerPhone, appId, url: raw });
    return true;
  } catch {
    return false;
  }
}

export function cloneCallOwnerPhone(account?: WaAccount): string {
  if (!account || (account.phoneE164 && account.historyPhoneE164 && account.phoneE164 !== account.historyPhoneE164)) return "";
  const phone = account.historyPhoneE164 || account.phoneE164 || "";
  return /^\+[1-9]\d{6,14}$/.test(phone) ? phone : "";
}

export function cloneCallTarget(chat: ChatPreview | null, contact: Contact | undefined, accounts: WaAccount[], selectedAccountId?: string): CloneCallTarget | null {
  if (!chat || chat.localOnly || chat.isGroup || contact?.isGroup) return null;
  const id = selectedAccountId || chat.accountId || contact?.accountId || chat.lastSuccessfulOutgoing?.accountId;
  // Calling must never use the global default or another online account as a fallback.
  const account = accounts.find(a => a.id === id);
  const ownerPhone = cloneCallOwnerPhone(account);
  const recipientPhone = resolveSendTarget({ phone: contact?.phone, channelAddress: contact?.channelAddress, entityId: contact?.id || chat.contactId });
  if (!account || !ownerPhone || !/^\+[1-9]\d{6,14}$/.test(recipientPhone) || ownerPhone === recipientPhone) return null;
  return { ownerPhone, recipientPhone, accountId: account.id, accountLabel: account.label };
}

export async function cloneCallInvoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error("请在 Windows 桌面版中使用通话客户端");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}
