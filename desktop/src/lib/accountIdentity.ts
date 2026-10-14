import { extractAccountHumanName } from "./accountLabels";
import type { WaAccount } from "@/types/account";
import type { BaileysStatus } from "./baileysCore";

export function accountPhone(status: Pick<BaileysStatus, "user">): string | undefined {
  const digits = status.user?.id?.split("@")[0]?.split(":")[0] || "";
  return /^\d{7,15}$/.test(digits) ? `+${digits}` : undefined;
}

/** 记录跟号码走，登录目录和展示位置可以交换。 */
export function reconcileAccountLogin(
  accounts: WaAccount[], id: string, status: BaileysStatus,
  sessionPhones: ReadonlyMap<string, string>
): WaAccount[] {
  const phone = accountPhone(status);
  const source = accounts.find(a => a.id === id);
  if (!phone || !source) return accounts;
  const bound = source.historyPhoneE164 || source.phoneE164;
  if (!bound && accounts.some(a => a.id !== id && (a.historyPhoneE164 || a.phoneE164) === phone)) {
    throw Object.assign(new Error("该号码已有历史账号，请在对应账号中登录，避免重复创建记录"), { status: 409 });
  }
  if (!bound || phone === bound) {
    return source.historyPhoneE164 === phone ? accounts : accounts.map(a => a.id === id
      ? { ...a, historyPhoneE164: phone } : a);
  }
  const target = accounts.find(a => a.id !== id && (a.historyPhoneE164 || a.phoneE164) === phone);
  if (!target) return accounts;
  // 两槽都已换位才交换；重复登录同一号码不能来回抢占历史。
  if (sessionPhones.get(target.sessionAccountId || target.id) !== bound) return accounts;
  return accounts.map(a => a.id === source.id
    ? { ...a, historyPhoneE164: bound, sessionAccountId: target.sessionAccountId || target.id,
        label: target.label, sort: target.sort, status: "disconnected", lastSyncAt: undefined }
    : a.id === target.id
      ? { ...a, historyPhoneE164: phone, sessionAccountId: source.sessionAccountId || source.id,
          label: source.label, sort: source.sort, status: "connected", lastSyncAt: undefined }
      : a);
}

export function resolveAccountIdentity(
  previous: Pick<WaAccount, "phoneE164" | "historyPhoneE164" | "userName" | "avatarUrl">,
  status: Pick<BaileysStatus, "connection" | "user">
) {
  const phone = accountPhone(status);
  const bound = previous.historyPhoneE164 || previous.phoneE164;
  if (phone && bound && phone !== bound) {
    throw Object.assign(new Error(`此记录属于 ${bound}，当前登录为 ${phone}，已阻止混入记录。请在对应号码的账号中登录。`), { status: 409 });
  }
  const changed = Boolean(phone && previous.phoneE164 && phone !== previous.phoneE164);
  if (status.connection === "qr" || status.connection === "logged_out") {
    return { phoneE164: bound, userName: previous.userName, avatarUrl: previous.avatarUrl, changed };
  }
  const name = extractAccountHumanName(status.user?.name) ||
    extractAccountHumanName(status.user?.notify) ||
    extractAccountHumanName(status.user?.verifiedName);
  return {
    phoneE164: phone || previous.phoneE164,
    userName: name || (changed ? phone : previous.userName || phone),
    avatarUrl: changed ? undefined : previous.avatarUrl,
    changed,
  };
}
