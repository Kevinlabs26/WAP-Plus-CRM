import type { GroupDetails } from "@/types/crm";

type JoinedGroupDeps = {
  accountId: string;
  groupJid: string;
  group?: GroupDetails;
  source?: string;
  ingest: (events: unknown[]) => void;
  findContactId: (groupJid: string, accountId: string) => string | undefined;
  openContact: (contactId: string) => void;
};

/** 将刚加入的群立即落入本地状态并打开，无需等待下一轮全量同步。 */
export function openJoinedGroup({
  accountId,
  groupJid,
  group,
  source = "group-invite-accept",
  ingest,
  findContactId,
  openContact,
}: JoinedGroupDeps): boolean {
  if (!groupJid || !accountId) return false;
  ingest([
    {
      type: "contacts.sync",
      deviceId: accountId,
      accountId,
      payload: {
        accountId,
        source,
        items: [
          {
            jid: groupJid,
            channelAddress: groupJid,
            isGroup: true,
            displayName: group?.subject || "",
            subject: group?.subject || "",
            participantCount: group?.participantCount,
            groupDesc: group?.desc,
            groupOwner: group?.owner,
            groupAnnounce: group?.announce,
            groupRestrict: group?.restrict,
            groupEphemeral: group?.ephemeralDuration,
            groupJoinApproval: group?.joinApprovalMode,
          },
        ],
      },
    },
  ]);
  const contactId = findContactId(groupJid, accountId);
  if (!contactId) return false;
  openContact(contactId);
  return true;
}
