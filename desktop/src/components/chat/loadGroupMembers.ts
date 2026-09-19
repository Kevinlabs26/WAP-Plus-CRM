import { baileysGroupMetadata } from "@/lib/baileysGroups";
import { enrichGroupMembers } from "@/lib/groupMemberDisplay";
import type { ChatPreview, Contact, GroupMember } from "@/types/crm";

export type GroupMemberOption = {
  jid: string;
  label: string;
  phoneE164?: string;
};

type LoadGroupMembersDeps = {
  contacts: Contact[];
  chats: ChatPreview[];
  selectedContactId: string | null;
  selectedChatId: string | null;
  isBaileys: boolean;
  liveBaileysAccountId?: string;
  activeAccountId?: string;
  isCancelled: () => boolean;
  setGroupMembers: (members: GroupMemberOption[]) => void;
  setGroupMemberDetails: (members: GroupMember[]) => void;
};

export async function loadGroupMembers({
  contacts,
  chats,
  selectedContactId,
  selectedChatId,
  isBaileys,
  liveBaileysAccountId,
  activeAccountId,
  isCancelled,
  setGroupMembers,
  setGroupMemberDetails,
}: LoadGroupMembersDeps) {
  const contact = contacts.find((item) => item.id === selectedContactId);
  const chat = chats.find((item) => item.id === selectedChatId);
  const isGroup = !!(contact?.isGroup || chat?.isGroup);
  if (!isBaileys || !isGroup) return;
  const raw =
    contact?.channelAddress ||
    (contact?.id || "").match(/[\w.-]+@g\.us/)?.[0] ||
    "";
  const jid = raw.includes("%") ? decodeURIComponent(raw) : raw;
  if (!jid.endsWith("@g.us")) return;
  const accountId =
    contact?.accountId ||
    chat?.accountId ||
    liveBaileysAccountId ||
    activeAccountId;
  try {
    const res = await baileysGroupMetadata(jid, accountId);
    if (isCancelled() || !res.ok || !res.group?.participants) return;
    const enriched = enrichGroupMembers(
      res.group.participants || [],
      contacts,
      accountId
    );
    setGroupMemberDetails(enriched);
    setGroupMembers(
      enriched.map((member) => ({
        jid: member.jid,
        label:
          member.displayName || member.name || member.phoneE164 || member.jid,
        phoneE164: member.phoneE164,
      }))
    );
  } catch {
    // 群元数据读取失败时保留空成员列表，避免打断会话渲染。
  }
}
