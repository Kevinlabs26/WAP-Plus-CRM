import type { Message } from "../types/crm";

type Identity = { name?: string; label?: string; userName?: string; phone?: string; phoneE164?: string; historyPhoneE164?: string };
let identityProvider: (() => Identity[]) | undefined;
export function setMusePrivacyIdentityProvider(provider: () => Identity[]) { identityProvider = provider; }
export function musePrivacyIdentities(): Identity[] {
  if (!identityProvider) throw Error("本机隐私检查尚未就绪，未发送给 Muse");
  return identityProvider();
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
    let result = text
      .replace(/BEGIN:VCARD[\s\S]*?(?:END:VCARD|$)/gi, "[shared contact omitted]")
      .replace(/^[^\r\n]*https?:\/\/(?:wa\.me|api\.whatsapp\.com\/send)[^\r\n]*$/gim, "[shared contact omitted]")
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email omitted]")
      .replace(/(?<![\p{L}\p{N}])\+?\d(?:[\d ().-]*\d)?(?![\p{L}\p{N}])/gu, value => {
        const digits = value.replace(/\D/g, "");
        if (phones.has(digits)) return "[phone omitted]";
        if (/^(?:\d{4}-\d{2}-\d{2}|\d{1,2}[-.]\d{1,2}[-.]\d{4})$/.test(value)) return value;
        return digits.length >= 7 ? "[phone omitted]" : value;
      });
    for(const pattern of namePatterns)result=result.replace(pattern,"[person omitted]");
    return result;
  };
  if(!messages.length)identityRedactors.set(identities,{signature,redact});
  return redact;
}
