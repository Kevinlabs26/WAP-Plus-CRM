import type {
  SettingsChatFolder,
  SettingsChatFolderClone,
} from "./settingsDefaults";

export function pruneChatFolderRefs(
  folders: SettingsChatFolder[],
  clones: SettingsChatFolderClone[],
  validChatIds: ReadonlySet<string>,
  replacements: ReadonlyMap<string, string> = new Map()
) {
  let changed = false;
  const nextFolders = folders.map((folder) => {
    const seen = new Set<string>();
    const chatIds = folder.chatIds
      .map((id) => {
        const replacement = replacements.get(id);
        if (replacement) changed = true;
        return replacement || id;
      })
      .filter((id) => {
        const keep = validChatIds.has(id) && !seen.has(id);
        if (!keep) changed = true;
        seen.add(id);
        return keep;
      });
    const unchanged =
      chatIds.length === folder.chatIds.length &&
      chatIds.every((id, index) => id === folder.chatIds[index]);
    return unchanged ? folder : { ...folder, chatIds };
  });
  const nextClones = clones
    .map((clone) => {
      const sourceChatId = replacements.get(clone.sourceChatId);
      if (sourceChatId) changed = true;
      return sourceChatId ? { ...clone, sourceChatId } : clone;
    })
    .filter((clone) => {
      const keep =
        validChatIds.has(clone.sourceChatId) &&
        nextFolders.some((folder) => folder.id === clone.folderId);
      if (!keep) changed = true;
      return keep;
    });
  return { folders: nextFolders, clones: nextClones, changed };
}
