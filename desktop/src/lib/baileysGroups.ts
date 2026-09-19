import type {
  BaileysCommonGroupsResponse,
  BaileysGroupInviteInfoResponse,
  BaileysGroupMetadataResponse,
} from "@shared/baileysProtocol";
import type { GroupDetails } from "@/types/crm";
import { request as baileysHttp } from "./baileys";

function encJid(groupJid: string) {
  return encodeURIComponent(String(groupJid || "").trim());
}

/** 查询当前 WhatsApp 账号与联系人共同所在的群组。 */
export function baileysCommonGroups(
  target: { jids?: string[]; phone?: string },
  accountId?: string | null,
  opts?: { force?: boolean }
) {
  return baileysHttp<BaileysCommonGroupsResponse>(
    "/groups/common",
    {
      method: "POST",
      body: JSON.stringify({ ...target, force: opts?.force === true }),
    },
    accountId
  );
}

/** GET 群元数据 + 成员列表（只读） */
export function baileysGroupMetadata(
  groupJid: string,
  accountId?: string | null
) {
  return baileysHttp<BaileysGroupMetadataResponse>(
    `/groups/${encJid(groupJid)}`,
    { method: "GET" },
    accountId
  );
}

/** 解析群邀请链接/邀请码（只读，不入群） */
export function baileysGroupInviteInfo(
  codeOrUrl: string,
  accountId?: string | null
) {
  return baileysHttp<BaileysGroupInviteInfoResponse>(
    "/groups/invite-info",
    {
      method: "POST",
      body: JSON.stringify({ code: codeOrUrl, url: codeOrUrl }),
    },
    accountId
  );
}

export type GroupWriteResponse = {
  ok: boolean;
  group?: GroupDetails;
  error?: string;
  code?: string;
  inviteCode?: string;
  inviteUrl?: string;
  groupJid?: string;
  done?: string[];
  result?: unknown;
};

export function baileysGroupUpdateSubject(
  groupJid: string,
  subject: string,
  accountId?: string | null
) {
  return baileysHttp<GroupWriteResponse>(
    `/groups/${encJid(groupJid)}/subject`,
    { method: "POST", body: JSON.stringify({ subject }) },
    accountId
  );
}

export function baileysGroupUpdateDescription(
  groupJid: string,
  description: string,
  accountId?: string | null
) {
  return baileysHttp<GroupWriteResponse>(
    `/groups/${encJid(groupJid)}/description`,
    { method: "POST", body: JSON.stringify({ description }) },
    accountId
  );
}

export function baileysGroupParticipants(
  groupJid: string,
  action: "add" | "remove" | "promote" | "demote",
  participants: string[],
  accountId?: string | null
) {
  return baileysHttp<GroupWriteResponse>(
    `/groups/${encJid(groupJid)}/participants`,
    {
      method: "POST",
      body: JSON.stringify({ action, participants }),
    },
    accountId
  );
}

export function baileysGroupInviteCode(
  groupJid: string,
  accountId?: string | null
) {
  return baileysHttp<GroupWriteResponse>(
    `/groups/${encJid(groupJid)}/invite`,
    { method: "GET" },
    accountId
  );
}

export function baileysGroupRevokeInvite(
  groupJid: string,
  accountId?: string | null
) {
  return baileysHttp<GroupWriteResponse>(
    `/groups/${encJid(groupJid)}/invite/revoke`,
    { method: "POST", body: "{}" },
    accountId
  );
}

export function baileysGroupLeave(
  groupJid: string,
  accountId?: string | null
) {
  return baileysHttp<GroupWriteResponse>(
    `/groups/${encJid(groupJid)}/leave`,
    { method: "POST", body: "{}" },
    accountId
  );
}

export function baileysGroupSettings(
  groupJid: string,
  patch: {
    announcement?: boolean;
    locked?: boolean;
    memberAddMode?: "admin_add" | "all_member_add";
    joinApprovalMode?: "on" | "off";
  },
  accountId?: string | null
) {
  return baileysHttp<GroupWriteResponse>(
    `/groups/${encJid(groupJid)}/settings`,
    { method: "POST", body: JSON.stringify(patch) },
    accountId
  );
}

export function baileysGroupAcceptInvite(
  codeOrUrl: string,
  accountId?: string | null
) {
  return baileysHttp<GroupWriteResponse>(
    "/groups/invite-accept",
    {
      method: "POST",
      body: JSON.stringify({ code: codeOrUrl, url: codeOrUrl }),
    },
    accountId
  );
}

export type GroupJoinRequest = {
  jid: string;
  status?: string;
  raw?: unknown;
};

export function baileysGroupJoinRequests(
  groupJid: string,
  accountId?: string | null
) {
  return baileysHttp<GroupWriteResponse & { pending?: GroupJoinRequest[] }>(
    `/groups/${encJid(groupJid)}/join-requests`,
    { method: "GET" },
    accountId
  );
}

export function baileysGroupJoinRequestsUpdate(
  groupJid: string,
  action: "approve" | "reject",
  participants: string[],
  accountId?: string | null
) {
  return baileysHttp<
    GroupWriteResponse & { pending?: GroupJoinRequest[]; result?: unknown }
  >(
    `/groups/${encJid(groupJid)}/join-requests`,
    {
      method: "POST",
      body: JSON.stringify({ action, participants }),
    },
    accountId
  );
}

export function baileysGroupCreate(
  subject: string,
  participants: string[] = [],
  accountId?: string | null
) {
  return baileysHttp<GroupWriteResponse & { group?: GroupDetails }>(
    "/groups/create",
    {
      method: "POST",
      body: JSON.stringify({ subject, participants }),
    },
    accountId
  );
}
