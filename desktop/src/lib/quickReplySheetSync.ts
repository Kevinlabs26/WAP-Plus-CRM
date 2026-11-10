import { letter, readSheet, tabRange, updateSheetCell } from "@/lib/googleSheets";
import { sheetErrorHint } from "@/lib/googleSheetErrors";
import type { TranslationKey } from "@/i18n";
import { useAppStore } from "@/store/appStore";
import type { QuickReplySheetLink } from "@/lib/quickReplies";

type Translate = (key: TranslationKey) => string;

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const versions = new Map<string, number>();
const active = new Map<string, number>();
const failures = new Map<string, number>();
let operations: Promise<unknown> = Promise.resolve();

// Keep row allocation and rollback in order across edits, additions and deletions.
function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = operations.then(operation);
  operations = result.catch(() => undefined);
  return result;
}

export function cancelQuickReplySheetSync(id: string) {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  versions.set(id, (versions.get(id) || 0) + 1);
}

export function scheduleQuickReplySheetSync(id: string, t: Translate) {
  const reply = useAppStore.getState().settings.quickReplies?.find(item => item.id === id);
  if (!reply?.sheetLink || !reply.sheetLink.row && !reply.body.trim() && !reply.translation?.trim()) return;
  setSyncState(id, true);
  failures.delete(id);
  const version = (versions.get(id) || 0) + 1;
  versions.set(id, version);
  const oldTimer = timers.get(id);
  if (oldTimer) clearTimeout(oldTimer);
  timers.set(id, setTimeout(() => {
    timers.delete(id);
    active.set(id, version);
    void enqueue(() => syncReply(id, version, t));
  }, 900));
}

function setSyncState(id: string, pending: boolean, error?: string) {
  const state = useAppStore.getState();
  const replies = state.settings.quickReplies || [];
  const reply = replies.find(item => item.id === id);
  if (!reply?.sheetLink || reply.sheetLink.syncPending === pending && reply.sheetLink.syncError === error) return;
  state.updateSettings({quickReplies: replies.map(item => item.id === id
    ? { ...item, sheetLink: { ...item.sheetLink!, syncPending: pending, syncError: error } } : item)});
}

export function resumePendingQuickReplySheetSync(t: Translate) {
  for (const reply of useAppStore.getState().settings.quickReplies || []) {
    const link = reply.sheetLink;
    if (!link || timers.has(reply.id) || active.has(reply.id)) continue;
    if (link.syncPending || reply.body !== link.originalSnapshot || (reply.translation || "") !== link.translationSnapshot) {
      scheduleQuickReplySheetSync(reply.id, t);
    }
  }
}

export function removeQuickReplySheetRow(link: QuickReplySheetLink) {
  return enqueue(() => removeRow(link));
}

async function removeRow(link: QuickReplySheetLink) {
  if (!link.row) return;
  const response = await readSheet(link.spreadsheetId, [cellRange(link, link.originalColumn), cellRange(link, link.translationColumn)]);
  if (response.valueRanges?.length !== 2 || cellValue(response, 0) !== link.originalSnapshot || cellValue(response, 1) !== link.translationSnapshot) {
    throw new Error("quickReplySheetConflict");
  }
  // shortcut: The Sheets update endpoint has no compare-and-set; this check minimizes concurrent-edit loss.
  try {
    await updateSheetCell(link.spreadsheetId, link.tab, link.originalColumn, link.row, "");
    await updateSheetCell(link.spreadsheetId, link.tab, link.translationColumn, link.row, "");
  } catch (error) {
    await Promise.allSettled([
      updateSheetCell(link.spreadsheetId, link.tab, link.originalColumn, link.row, link.originalSnapshot),
      updateSheetCell(link.spreadsheetId, link.tab, link.translationColumn, link.row, link.translationSnapshot),
    ]);
    throw error;
  }
}

export function restoreQuickReplySheetRow(link: QuickReplySheetLink) {
  return enqueue(() => restoreRow(link));
}

async function restoreRow(link: QuickReplySheetLink) {
  if (!link.row) return;
  await updateSheetCell(link.spreadsheetId, link.tab, link.originalColumn, link.row, link.originalSnapshot);
  await updateSheetCell(link.spreadsheetId, link.tab, link.translationColumn, link.row, link.translationSnapshot);
}

function cellValue(response: Awaited<ReturnType<typeof readSheet>>, index: number) {
  return String(response.valueRanges?.[index]?.values?.[0]?.[0] ?? "").trim();
}

function cellRange(link: QuickReplySheetLink, column: number) {
  const name = letter(column);
  return `${tabRange(link.tab)}!${name}${link.row}:${name}${link.row}`;
}

async function syncReply(id: string, version: number, t: Translate) {
  const latest = () => versions.get(id) === version;
  try {
    if (!latest()) return;
    const reply = useAppStore.getState().settings.quickReplies?.find(item => item.id === id);
    const link = reply?.sheetLink;
    if (!reply || !link || link.row === 0 && !reply.body.trim() && !reply.translation?.trim()) return;

    const creating = link.row === 0;
    const response = await readSheet(link.spreadsheetId, creating
      ? [`${tabRange(link.tab)}!${letter(link.originalColumn)}:${letter(link.originalColumn)}`, `${tabRange(link.tab)}!${letter(link.translationColumn)}:${letter(link.translationColumn)}`]
      : [cellRange(link, link.originalColumn), cellRange(link, link.translationColumn)]);
    if (!latest()) return;
    if (response.valueRanges?.length !== 2) throw new Error("Incomplete Google Sheets response");

    const row = creating
      ? Math.max(response.valueRanges[0].values?.[0]?.length || 0, response.valueRanges[1].values?.[0]?.length || 0) + 1
      : link.row;
    if (row > 10_000_000) throw new Error("Invalid Google Sheets row");
    const remoteBody = creating ? "" : cellValue(response, 0);
    const remoteTranslation = creating ? "" : cellValue(response, 1);
    const localBody = reply.body;
    const localTranslation = reply.translation || "";
    const localBodyChanged = localBody !== link.originalSnapshot;
    const localTranslationChanged = localTranslation !== link.translationSnapshot;
    const remoteBodyChanged = remoteBody !== link.originalSnapshot;
    const remoteTranslationChanged = remoteTranslation !== link.translationSnapshot;
    const conflict = localBodyChanged && remoteBodyChanged && localBody !== remoteBody || localTranslationChanged && remoteTranslationChanged && localTranslation !== remoteTranslation;
    const overwrite = conflict ? await useAppStore.getState().requestConfirm({
      title: t("quickLibrary.sheetConflictTitle"),
      description: t("quickLibrary.sheetConflictDescription"),
      confirmLabel: t("quickLibrary.sheetOverwrite"),
      cancelLabel: t("quickLibrary.sheetKeepRemote"),
    }) : true;
    if (!latest()) return;

    const body = remoteBodyChanged && !localBodyChanged || conflict && !overwrite && remoteBodyChanged ? remoteBody : localBody;
    const translation = remoteTranslationChanged && !localTranslationChanged || conflict && !overwrite && remoteTranslationChanged ? remoteTranslation : localTranslation;
    const changes = [
      ...(body !== remoteBody ? [{ column: link.originalColumn, before: remoteBody, after: body }] : []),
      ...(translation !== remoteTranslation ? [{ column: link.translationColumn, before: remoteTranslation, after: translation }] : []),
    ];
    const written: typeof changes = [];
    try {
      for (const change of changes) {
        if (!latest()) {
          await Promise.allSettled(written.map(item => updateSheetCell(link.spreadsheetId, link.tab, item.column, row, item.before)));
          return;
        }
        await updateSheetCell(link.spreadsheetId, link.tab, change.column, row, change.after);
        written.push(change);
      }
    } catch (error) {
      await Promise.allSettled(written.map(item => updateSheetCell(link.spreadsheetId, link.tab, item.column, row, item.before)));
      throw error;
    }
    if (!latest()) {
      await Promise.allSettled(written.map(item => updateSheetCell(link.spreadsheetId, link.tab, item.column, row, item.before)));
      return;
    }

    const current = useAppStore.getState().settings.quickReplies || [];
    useAppStore.getState().updateSettings({ quickReplies: current.map(item => item.id === id ? {
      ...item,
      body,
      ...(translation ? { translation } : { translation: undefined }),
      sheetLink: { ...link, row, originalSnapshot: body, translationSnapshot: translation, syncPending: false, syncError: undefined },
    } : item) });
    if (body !== localBody || translation !== localTranslation) useAppStore.getState().pushToast(t("quickLibrary.sheetKeptRemote"), "info");
    else if (body !== remoteBody || translation !== remoteTranslation) useAppStore.getState().pushToast(t("quickLibrary.sheetSynced"), "success");
  } catch (error) {
    if (latest()) {
      const hint = t(sheetErrorHint(String(error)));
      setSyncState(id, true, hint);
      const count = (failures.get(id) || 0) + 1;
      failures.set(id, count);
      if (count === 1) useAppStore.getState().pushToast(hint, "error");
      timers.set(id, setTimeout(() => {
        timers.delete(id);
        if (!latest()) return;
        active.set(id, version);
        void enqueue(() => syncReply(id, version, t));
      }, Math.min(300_000, 30_000 * 2 ** Math.min(count - 1, 4))));
    }
  } finally {
    if (active.get(id) === version) active.delete(id);
  }
}
