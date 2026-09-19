import { request } from "./baileysCore";

export type BaileysProfileUpdate = {
  name?: string;
  status?: string;
  avatarDataUrl?: string;
};

export type BaileysProfileResult = {
  ok: boolean;
  name?: boolean;
  status?: boolean;
  avatar?: boolean;
};

/** 改自己 WhatsApp 昵称 / 个性签名 / 头像 */
export const baileysUpdateProfile = (
  patch: BaileysProfileUpdate,
  accountId?: string | null
) =>
  request<BaileysProfileResult>(
    "/profile",
    {
      method: "POST",
      body: JSON.stringify(patch),
    },
    accountId
  );
