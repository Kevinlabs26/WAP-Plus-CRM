import { baileysBlocklistSet } from "@/lib/baileysBlocklist";
import {
  getAccountBlocklist,
  isJidBlocked,
  setAccountBlocklist,
} from "@/lib/accountWaMeta";
import type { AppSettings, AppState } from "@/store/appStore";
import type { Contact } from "@/types/crm";
import type { TranslationKey } from "@/i18n";

type Translator = (
  key: TranslationKey,
  params?: Record<string, string | number>
) => string;

type ToggleBlockActionDeps = {
  isBaileys: boolean;
  activeContact: Contact | null | undefined;
  chatAccountId: string | null;
  connected: boolean;
  settings: AppSettings;
  updateSettings: AppState["updateSettings"];
  pushToast: AppState["pushToast"];
  requestConfirm: AppState["requestConfirm"];
  t: Translator;
};

export async function toggleBlock({
  isBaileys,
  activeContact,
  chatAccountId,
  connected,
  settings,
  updateSettings,
  pushToast,
  requestConfirm,
  t,
}: ToggleBlockActionDeps) {
  if (!isBaileys || !activeContact || activeContact.isGroup) return;
  if (!connected) {
    // 账号未连接时仍保留明确的能力边界，提示文本由语言包提供。
    pushToast(t("chat.notConnected"), "error");
    return;
  }
  const target = activeContact.channelAddress || activeContact.phone || "";
  if (!target) {
    pushToast(t("chat.noAddress"), "error");
    return;
  }
  const list = getAccountBlocklist(
    settings.blocklistByAccountId,
    chatAccountId ||
      settings.liveBaileysAccountId ||
      settings.activeAccountId ||
      "",
    settings.blocklistJids
  );
  const blocked = isJidBlocked(list, target);
  const action = blocked ? "unblock" : "block";
  if (action === "block") {
    const ok = await requestConfirm({
      title: t("chat.blockConfirmTitle", { name: activeContact.name || target }),
      description: t("chat.blockConfirmDescription"),
      confirmLabel: t("chat.blockContact"),
      cancelLabel: t("common.cancel"),
      tone: "danger",
    });
    if (!ok) return;
  }
  try {
    const result = await baileysBlocklistSet(target, action, chatAccountId);
    if (!result.ok) {
      pushToast(result.error || t("chat.operationFailed"), "error");
      return;
    }
    if (result.jids) {
      const accountId =
        chatAccountId ||
        settings.liveBaileysAccountId ||
        settings.activeAccountId ||
        "wa-default";
      updateSettings({
        blocklistByAccountId: setAccountBlocklist(
          settings.blocklistByAccountId,
          accountId,
          result.jids
        ),
        blocklistJids: result.jids,
      });
    }
    pushToast(
      t(action === "block" ? "chat.blockedToast" : "chat.unblockedToast"),
      "success"
    );
  } catch (error) {
    pushToast(error instanceof Error ? error.message : String(error), "error");
  }
}
