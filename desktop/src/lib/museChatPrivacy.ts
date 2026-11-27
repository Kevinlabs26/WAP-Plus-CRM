import type { Message } from "../types/crm";
import { redactAiContent } from "./aiPrivacy.ts";

type Identity = { name?: string; label?: string; userName?: string; phone?: string; phoneE164?: string; historyPhoneE164?: string };
type MusePrivacyByAccount = Record<string, { trainingDisabledConfirmedAt?: number; memoryReviewedAt?: number }>;
type MusePrivacyProviders = {
  identityProvider?: () => Identity[];
  privacyProvider?: () => MusePrivacyByAccount;
  privacyGateMessageProvider?: () => string;
};
const MUSE_PRIVACY_REGISTRY_KEY = Symbol.for("wapPlusCrm.museChatPrivacyProviders");
function getMusePrivacyProviders(): MusePrivacyProviders {
  const host = globalThis as Record<symbol, MusePrivacyProviders | undefined>;
  if (!host[MUSE_PRIVACY_REGISTRY_KEY]) {
    host[MUSE_PRIVACY_REGISTRY_KEY] = {};
  }
  return host[MUSE_PRIVACY_REGISTRY_KEY]!;
}
// Keep provider hooks on a global registry so Vite HMR or duplicated imports never drop them.
export function setMusePrivacyIdentityProvider(provider: () => Identity[]) { getMusePrivacyProviders().identityProvider = provider; }
export function setMusePrivacySettingsProvider(provider: () => MusePrivacyByAccount) { getMusePrivacyProviders().privacyProvider = provider; }
export function setMusePrivacyGateMessageProvider(provider: () => string) { getMusePrivacyProviders().privacyGateMessageProvider = provider; }
export function musePrivacyGateMessage(): string { return getMusePrivacyProviders().privacyGateMessageProvider?.() || "此 Muse 账号未确认关闭模型训练，CRM 已阻止本次请求。"; }
export function musePrivacyGateError(accountId: string): Error {
  const baseMessage = musePrivacyGateMessage();
  if (!getMusePrivacyProviders().privacyProvider) {
    return Error(`${baseMessage}（本机隐私状态未初始化，请刷新页面后重试）`);
  }
  return Error(accountId ? `${baseMessage}（账号 ID：${accountId}）` : baseMessage);
}
export function museTrainingDisabledConfirmed(accountId: string): boolean {
  return !!accountId && !!getMusePrivacyProviders().privacyProvider?.()?.[accountId]?.trainingDisabledConfirmedAt;
}
export function musePrivacyIdentities(): Identity[] {
  const provider = getMusePrivacyProviders().identityProvider;
  if (!provider) throw Error("本机隐私检查尚未就绪，未发送给 Muse");
  return provider();
}

export function museChatMessages(messages: Message[], chatId?: string, accountId?: string): Message[] {
  return messages.filter(message => (!chatId || message.chatId === chatId) &&
    (!accountId || !(message.accountId || message.deviceId) || (message.accountId || message.deviceId) === accountId));
}

const identityRedactors=new WeakMap<Identity[],{signature:string;redact:(text:string)=>string}>();
export function createMuseChatRedactor(identities: Identity[], messages: Message[] = []) {
  const signature=messages.length?'':JSON.stringify(identities.map(item=>[item.name,item.label,item.userName,item.phone,item.phoneE164,item.historyPhoneE164]));
  const cached=!messages.length?identityRedactors.get(identities):undefined;
  if(cached?.signature===signature)return cached.redact;
  const names = new Set([...identities.flatMap(item => [item.name, item.userName, item.label?.replace(/^\s*\d+\s*:\s*/, "")]), ...messages.flatMap(item => [item.senderName, item.quoted?.senderName])]
    .map(name => name?.trim() || "").filter(name => name.length >= 2 && /\p{L}/u.test(name)));
  const escaped = [...new Set([...names].flatMap(name => [name, JSON.stringify(name).slice(1, -1)]))]
    .sort((a, b) => b.length - a.length);
  // Bound each expression: thousands of alternatives cause long main-thread stalls in WebView.
  const namePatterns:RegExp[]=[];
  for(const han of [false,true]){
    const literals=escaped.filter(name=>/\p{Script=Han}/u.test(name)===han).map(name=>name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"));
    for(let i=0;i<literals.length;i+=100){
      const alternatives=literals.slice(i,i+100).join("|");
      namePatterns.push(new RegExp(han?alternatives:`(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`,"gu"));
    }
  }
  const phones = new Set(identities.flatMap(item => [item.phone, item.phoneE164, item.historyPhoneE164]).concat(
    messages.flatMap(item => [item.senderPhoneE164, item.accountPhoneE164, item.phoneE164]))
    .map(phone => phone?.replace(/\D/g, "") || "").filter(phone => phone.length >= 6));
  const redact = (text: string): string => {
    text = redactAiContent(text) || "";
    const youtubeLinks: string[] = [];
    let result = text
      .replace(/BEGIN:VCARD[\s\S]*?(?:END:VCARD|$)/gi, "[shared contact omitted]")
      .replace(/^[^\r\n]*https?:\/\/(?:wa\.me|api\.whatsapp\.com\/send)[^\r\n]*$/gim, "[shared contact omitted]")
      .replace(/(?:https?:\/\/|www\.)[^\s<>"'`]+/giu, link => {
        const hostname = link.match(/^(?:https?:\/\/|www\.)([^/:?#]+)/i)?.[1]?.toLowerCase() || "";
        if (hostname === "youtu.be" || hostname.endsWith(".youtu.be") || hostname === "youtube.com" || hostname.endsWith(".youtube.com") || hostname === "youtube-nocookie.com" || hostname.endsWith(".youtube-nocookie.com")) {
          const index = youtubeLinks.push(link) - 1;
          return `\uE000${index}\uE001`;
        }
        return "[shared link omitted]";
      })
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email omitted]")
      .replace(/(?<![\p{L}\p{N}])\+?\d(?:[\d ().-]*\d)?(?![\p{L}\p{N}])/gu, value => {
        const digits = value.replace(/\D/g, "");
        if (phones.has(digits)) return "[phone omitted]";
        if (/^(?:\d{4}-\d{2}-\d{2}|\d{1,2}[-.]\d{1,2}[-.]\d{4})$/.test(value)) return value;
        return digits.length >= 7 ? "[phone omitted]" : value;
      });
    for(const pattern of namePatterns)result=result.replace(pattern,"[person omitted]");
    return result.replace(/\uE000(\d+)\uE001/g, (_, index: string) => youtubeLinks[Number(index)] || "");
  };
  if(!messages.length)identityRedactors.set(identities,{signature,redact});
  return redact;
}
