import type { FolderScope } from "@/types/account";
import type { SettingsShape } from "./settingsDefaults";
import { normalizeLocale, translate, type TranslationKey } from "../i18n/core.ts";

type FolderStoreDeps = {
  getSettings: () => SettingsShape;
  updateSettings: (
    patch: Partial<Pick<SettingsShape, "chatFolders" | "chatFolderClones">>
  ) => void;
  pushToast: (message: string, tone?: "info" | "success" | "error") => void;
};

export function createChatFolderActions({
  getSettings,
  updateSettings,
  pushToast,
}: FolderStoreDeps) {
  const t = (
    key: TranslationKey,
    params?: Record<string, string | number>
  ) => translate(normalizeLocale(getSettings().uiLanguage), key, params);

  return {
    createChatFolder(name: string, parentId?: string | null): string | null {
      const title = name.trim().slice(0, 40);
      if (!title) {
        pushToast(t("folder.toastNameRequired"), "error");
        return null;
      }
      const folders = getSettings().chatFolders || [];
      if (folders.length >= 40) {
        pushToast(t("folder.toastLimit"), "info");
        return null;
      }
      const id = `folder-${Date.now().toString(36)}`;
      const nextSort =
        folders.reduce((max, folder) => Math.max(max, folder.sort || 0), -1) + 1;
      const settings = getSettings();
      const view = settings.accountViewMode || { type: "all" as const };
      const scope: FolderScope =
        view.type === "account"
          ? { type: "account", accountId: view.accountId }
          : view.type === "all"
            ? { type: "all" }
            : { type: "account", accountId: settings.activeAccountId };
      const parent = parentId
        ? folders.find((folder) => folder.id === parentId)
        : undefined;
      if (parent?.parentId) {
        pushToast(t("folder.toastNestedLimit"), "info");
        return null;
      }
      updateSettings({
        chatFolders: [
          ...folders,
          {
            id,
            name: title,
            ...(parent ? { parentId: parent.id } : {}),
            sort: nextSort,
            collapsed: false,
            chatIds: [],
            scope,
          },
        ],
      });
      pushToast(t("folder.toastCreated", { name: title }), "success");
      return id;
    },

    renameChatFolder(folderId: string, name: string) {
      const title = name.trim().slice(0, 40);
      if (!title) return;
      updateSettings({
        chatFolders: getSettings().chatFolders.map((folder) =>
          folder.id === folderId ? { ...folder, name: title } : folder
        ),
      });
    },

    deleteChatFolder(folderId: string) {
      const folders = getSettings().chatFolders || [];
      const deleted = folders.find((folder) => folder.id === folderId);
      const nextFolders = folders
        .filter((folder) => folder.id !== folderId)
        .map((folder) =>
          folder.parentId === folderId
            ? {
                ...folder,
                ...(deleted?.parentId
                  ? { parentId: deleted.parentId }
                  : { parentId: undefined }),
              }
            : folder
        );
      const nextClones = (getSettings().chatFolderClones || []).filter(
        (clone) => clone.folderId !== folderId
      );
      updateSettings({ chatFolders: nextFolders, chatFolderClones: nextClones });
      pushToast(t("folder.toastDeleted"), "info");
    },

    clearChatFolder(folderId: string) {
      const settings = getSettings();
      updateSettings({
        chatFolders: (settings.chatFolders || []).map((folder) =>
          folder.id === folderId ? { ...folder, chatIds: [] } : folder
        ),
        chatFolderClones: (settings.chatFolderClones || []).filter(
          (clone) => clone.folderId !== folderId
        ),
      });
      pushToast(t("folder.toastCleared"), "info");
    },

    toggleChatFolderCollapsed(folderId: string) {
      updateSettings({
        chatFolders: getSettings().chatFolders.map((folder) =>
          folder.id === folderId
            ? { ...folder, collapsed: !folder.collapsed }
            : folder
        ),
      });
    },

    reorderChatFolder(folderId: string, targetFolderId: string, after = false) {
      if (!folderId || folderId === targetFolderId) return;
      const folders = getSettings().chatFolders || [];
      const source = folders.find((folder) => folder.id === folderId);
      const target = folders.find((folder) => folder.id === targetFolderId);
      if (!source || !target || source.parentId !== target.parentId) return;

      const siblings = folders
        .filter(
          (folder) =>
            folder.parentId === source.parentId &&
            folder.scope?.type === source.scope?.type &&
            (folder.scope?.type !== "account" ||
              folder.scope.accountId ===
                (source.scope?.type === "account"
                  ? source.scope.accountId
                  : undefined))
        )
        .sort((a, b) =>
          source.parentId
            ? (b.sort || 0) - (a.sort || 0) || a.name.localeCompare(b.name, "zh")
            : (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name, "zh")
        );
      const from = siblings.findIndex((folder) => folder.id === folderId);
      const to = siblings.findIndex((folder) => folder.id === targetFolderId);
      if (from < 0 || to < 0) return;
      const [moved] = siblings.splice(from, 1);
      siblings.splice(
        Math.max(0, to + (after ? 1 : 0) - (from < to ? 1 : 0)),
        0,
        moved!
      );
      const sortById = new Map(
        siblings.map((folder, index) => [
          folder.id,
          source.parentId ? siblings.length - index : index,
        ])
      );
      updateSettings({
        chatFolders: folders.map((folder) =>
          sortById.has(folder.id)
            ? { ...folder, sort: sortById.get(folder.id)! }
            : folder
        ),
      });
    },

    moveChatToFolder(chatId: string, folderId: string | null) {
      if (!chatId) return;
      let folders = (getSettings().chatFolders || []).map((folder) => ({
        ...folder,
        chatIds: folder.chatIds.filter((id) => id !== chatId),
      }));
      const clones = (getSettings().chatFolderClones || []).filter(
        (clone) => !(clone.sourceChatId === chatId && clone.folderId === folderId)
      );
      if (folderId) {
        folders = folders.map((folder) =>
          folder.id === folderId
            ? { ...folder, chatIds: [...folder.chatIds, chatId] }
            : folder
        );
      }
      updateSettings({ chatFolders: folders, chatFolderClones: clones });
    },

    cloneChatToFolder(chatId: string, folderId: string) {
      if (!chatId || !folderId) return;
      const folders = getSettings().chatFolders || [];
      const folder = folders.find((item) => item.id === folderId);
      if (!folder) {
        pushToast(t("folder.toastNotFound"), "error");
        return;
      }
      if (folder.chatIds.includes(chatId)) {
        pushToast(t("folder.toastAlreadyPrimary"), "info");
        return;
      }
      const clones = getSettings().chatFolderClones || [];
      if (clones.some((clone) => clone.folderId === folderId && clone.sourceChatId === chatId)) {
        pushToast(t("folder.toastCloneExists"), "info");
        return;
      }
      const id = `clone-${Date.now().toString(36)}`;
      updateSettings({
        chatFolderClones: [...clones, { id, folderId, sourceChatId: chatId }],
      });
      pushToast(t("folder.toastCloned", { name: folder.name }), "success");
    },

    removeChatFolderClone(cloneId: string) {
      updateSettings({
        chatFolderClones: (getSettings().chatFolderClones || []).filter(
          (clone) => clone.id !== cloneId
        ),
      });
    },
  };
}
