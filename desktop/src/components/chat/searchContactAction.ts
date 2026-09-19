import { bridgeInvoke } from "@/lib/bridge";
import type { AppState } from "@/store/appStore";
import type { Contact } from "@/types/crm";

type SearchContactActionDeps = {
  activeContact: Contact | null | undefined;
  searchingContact: boolean;
  bridgeConnected: boolean;
  selectedPhoneId: string | null;
  setSearchingContact: (searching: boolean) => void;
  pushToast: AppState["pushToast"];
};

export async function searchContact({
  activeContact,
  searchingContact,
  bridgeConnected,
  selectedPhoneId,
  setSearchingContact,
  pushToast,
}: SearchContactActionDeps) {
  if (!activeContact || searchingContact) return;
  if (!bridgeConnected) {
    pushToast("请先连接手机 Bridge", "error");
    return;
  }
  setSearchingContact(true);
  try {
    const result = await bridgeInvoke<{
      opened: boolean;
      candidates: Array<{ displayName: string; resultIndex: number }>;
    }>("search_whatsapp_contact", {
      deviceId: selectedPhoneId,
      query: activeContact.name,
    });
    pushToast(
      result.opened
        ? `已在手机打开 ${activeContact.name} 的聊天`
        : `找到 ${result.candidates.length} 个同名联系人，请在手机搜索结果中选择`,
      result.opened ? "success" : "info"
    );
  } catch (error) {
    pushToast(error instanceof Error ? error.message : String(error), "error");
  } finally {
    setSearchingContact(false);
  }
}
