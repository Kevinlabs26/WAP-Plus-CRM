import type { ChatPreview, Contact } from "@/types/crm";
import type { SettingsChatFolder } from "./settingsDefaults";

type ImportDeps = {
  getFolder: (folderId: string) => SettingsChatFolder | undefined;
  getContacts: () => Contact[];
  getChats: () => ChatPreview[];
  defaultAccountId: () => string | null;
  selectedPhoneId: () => string | null;
  addContact: (contact: Omit<Contact, "id">) => void;
  prependChat: (chat: ChatPreview) => void;
  moveChatToFolder: (chatId: string, folderId: string) => void;
  recomputeStats: () => void;
  persist: (immediate?: boolean) => void;
  pushToast: (message: string, tone?: "info" | "success" | "error") => void;
};

/** 一行一个号码；允许号码内部出现空格、横线、括号。 */
export function parseFolderPhoneEntries(rawText: string): string[] {
  return String(rawText || "")
    .split(/\r?\n|[,;，；]+/)
    .map((entry) => entry.replace(/\D/g, ""))
    .filter(Boolean);
}

export function importPhonesToFolder(
  folderId: string,
  rawText: string,
  deps: ImportDeps
) {
  const folder = deps.getFolder(folderId);
  if (!folder) {
    deps.pushToast("分组不存在", "error");
    return { matched: 0, created: 0, skipped: 0 };
  }

  const tokens = parseFolderPhoneEntries(rawText);
  let matched = 0;
  let created = 0;
  let skipped = 0;
  const digitsOnly = (value: string) => value.replace(/\D/g, "");
  const seen = new Set<string>();
  const folderAccountId =
    folder.scope?.type === "account" ? folder.scope.accountId : null;

  for (const token of tokens) {
    const digits = digitsOnly(token);
    if (
      digits.length < 7 ||
      digits.length > 15 ||
      seen.has(digits)
    ) {
      skipped += 1;
      continue;
    }
    seen.add(digits);

    const phonePlus = `+${digits}`;
    let contacts = deps.getContacts().filter((item) => {
      const phoneDigits = digitsOnly(item.phone || "");
      const phoneMatches =
        phoneDigits === digits ||
        (phoneDigits.length >= 7 &&
          (phoneDigits.endsWith(digits) || digits.endsWith(phoneDigits)));
      const owner = item.accountId || item.boundPhoneId || "";
      return phoneMatches && (!folderAccountId || owner === folderAccountId);
    });

    if (!contacts.length) {
      const accountId =
        folderAccountId ||
        deps.defaultAccountId() ||
        deps.selectedPhoneId() ||
        "baileys";
      deps.addContact({
        name: phonePlus,
        phone: phonePlus,
        stage: "new",
        tags: [],
        notes: "",
        boundPhoneId: accountId,
        accountId,
        source: "分组导入",
      });
      contacts = deps
        .getContacts()
        .filter(
          (item) =>
            digitsOnly(item.phone || "") === digits &&
            (item.accountId || item.boundPhoneId || "") === accountId
        );
      created += 1;
    } else {
      matched += 1;
    }

    if (!contacts.length) {
      skipped += 1;
      continue;
    }

    for (const contact of contacts) {
      let chat = deps
        .getChats()
        .find((item) => item.contactId === contact.id);
      if (!chat) {
        chat = {
          id: `bridge-chat-${contact.id}`,
          contactId: contact.id,
          contactName: contact.name || phonePlus,
          lastMessage: "",
          unread: 0,
          updatedAt: new Date().toISOString(),
          phoneId: contact.boundPhoneId || deps.selectedPhoneId() || "baileys",
          accountId:
            contact.accountId ||
            contact.boundPhoneId ||
            deps.selectedPhoneId() ||
            "baileys",
        };
        deps.prependChat(chat);
      }
      deps.moveChatToFolder(chat.id, folderId);
    }
  }

  deps.recomputeStats();
  // 这类导入是明确的批量写入动作，结束时立即落盘。
  deps.persist(true);
  deps.pushToast(
    `导入完成 · 匹配 ${matched} · 新建 ${created} · 跳过 ${skipped}`,
    "success"
  );
  return { matched, created, skipped };
}
