import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "@/store/appStore";
import { Button, SectionLabel } from "@/components/ui/primitives";
import { getDbInfo, getStorageEngine, resolveStorageEngine } from "@/lib/storage";
import { clearMediaCache, getMediaCacheStats, type MediaCacheStats } from "@/lib/mediaCache";
import { findInactiveChats } from "@/lib/inactiveChatCleanup";
import { ContactImportModal } from "./ContactImportModal";
import { parseBackupJson, readJsonFile } from "@/lib/exportData";
import { useI18n } from "@/i18n";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/bridge";
import { runAutomaticBackup, type AutomaticBackupStatus } from "@/lib/automaticBackup";

export function SettingsDataPanel() {
  const { t } = useI18n();
  const automaticBackupEnabled = useAppStore((s) => s.settings.automaticBackupEnabled !== false);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const [automaticStatus, setAutomaticStatus] = useState<AutomaticBackupStatus | null>(null);
  const [automaticBusy, setAutomaticBusy] = useState(false);
  useEffect(() => {
    const refresh = () => {
      if (isTauri()) void invoke<AutomaticBackupStatus>("crm_backup_status").then(setAutomaticStatus).catch(() => {});
    };
    refresh();
    window.addEventListener("wap:automatic-backup", refresh);
    return () => window.removeEventListener("wap:automatic-backup", refresh);
  }, []);
  const clearData = useAppStore((state) => state.clearData);
  const exportBackup = useAppStore((state) => state.exportBackup);
  const exportContactsCsv = useAppStore((state) => state.exportContactsCsv);
  const importBackup = useAppStore((state) => state.importBackup);
  const pushToast = useAppStore((state) => state.pushToast);
  const requestConfirm = useAppStore((state) => state.requestConfirm);
  const [dbLabel, setDbLabel] = useState("");
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [includeMedia, setIncludeMedia] = useState(false);
  const [lastBackup, setLastBackup] = useState(() => {
    try { return localStorage.getItem("crm-last-backup") || ""; } catch { return ""; }
  });
  const backupBusy = useRef(false);
  const onExport = async () => {
    if (backupBusy.current) return;
    backupBusy.current = true;
    setExporting(true);
    try {
      await exportBackup(includeMedia);
      const time = new Date().toISOString();
      setLastBackup(time);
      try { localStorage.setItem("crm-last-backup", time); } catch { /* UI 元数据不阻塞导出 */ }
    } catch { /* store 已显示失败原因 */ }
    finally { backupBusy.current = false; setExporting(false); }
  };
  const [clearingMedia, setClearingMedia] = useState(false);
  const [mediaCacheStats, setMediaCacheStats] = useState<MediaCacheStats | null>(null);
  const [clearingData, setClearingData] = useState(false);
  const [releasingHistory, setReleasingHistory] = useState(false);
  const [releaseDays, setReleaseDays] = useState(90);
  const [importOpen, setImportOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const chats = useAppStore((state) => state.chats);
  const contacts = useAppStore((state) => state.contacts);
  const selectedChatId = useAppStore((state) => state.selectedChatId);
  const releaseInactiveChatHistory = useAppStore(
    (state) => state.releaseInactiveChatHistory
  );
  const inactiveChats = useMemo(
    () =>
      findInactiveChats(chats, contacts, {
        olderThanDays: releaseDays,
        excludedChatId: selectedChatId,
      }),
    [chats, contacts, releaseDays, selectedChatId]
  );

  useEffect(() => {
    void (async () => {
      await resolveStorageEngine();
      const info = await getDbInfo();
      if (getStorageEngine() === "sqlite" && info) {
        setDbLabel(
          t("settingsData.sqliteInfo", { contacts: Number(info.contacts) || 0, messages: Number(info.messages) || 0 }) + `${
            info.lastSavedAt
              ? ` · ${t("settingsData.lastSaved", { time: String(info.lastSavedAt).slice(0, 19) })}`
              : ""
          }`
        );
      } else {
        setDbLabel(t("settingsData.indexedDb"));
      }
      setMediaCacheStats(await getMediaCacheStats());
    })();
  }, [t]);

  const formatCacheSize = (chars: number) => {
    const mb = chars / (1024 * 1024);
    return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
  };

  const onPickImport = async (file: File | null) => {
    if (!file || backupBusy.current) return;
    backupBusy.current = true;
    setImporting(true);
    try {
      const raw = await readJsonFile(file);
      const preview = parseBackupJson(raw);
      const ok = await requestConfirm({
        title: t("settingsData.restoreTitle"),
        description: t("settingsData.restoreDescription") + "\n" + t("settingsData.restorePreview", {
          contacts: preview.contacts.length, messages: preview.messages.length,
          attachments: preview.messages.filter((message) => message.mediaUrl?.startsWith("data:")).length,
        }),
        confirmLabel: t("settingsData.restoreConfirm"),
        cancelLabel: t("common.cancel"),
        tone: "danger",
      });
      if (!ok) return;
      const result = await importBackup(raw);
      if (!result.ok) throw new Error(result.reason || t("settingsData.restoreFailed"));
      pushToast(t("settingsData.restoreDone"), "success");
    } catch (e) {
      pushToast(e instanceof Error ? e.message : t("settingsData.restoreFailed"), "error");
    } finally {
      backupBusy.current = false;
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h3 className="text-lg font-semibold text-zinc-100">{t("settingsData.title")}</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
          {t("settingsData.description")}
        </p>
      </header>

      {isTauri() && <section className="rounded-lg border border-zinc-800 p-4 text-[12px]">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={automaticBackupEnabled} onChange={(e) => updateSettings({ automaticBackupEnabled: e.target.checked })} />
          {t("backup.enabled")}
        </label>
        <p className="mt-2 text-zinc-400">{t("backup.hint")}</p>
        <p className="mt-2 break-all text-zinc-500">{automaticStatus?.folder}</p>
        <p className="mt-1 text-zinc-400">{t("backup.latest")}：{automaticStatus?.latestDay || t("backup.none")}</p>
        <div className="mt-3 flex gap-2">
          <Button disabled={automaticBusy || importing} onClick={async () => {
            setAutomaticBusy(true);
            try {
              const status = await runAutomaticBackup(useAppStore.getState, true);
              if (!status) throw new Error(t("backup.unavailable"));
              setAutomaticStatus(status);
              pushToast(t("backup.saved"), "success");
            } catch (e) { pushToast(`${t("backup.failed")}：${String(e)}`, "error"); }
            finally { setAutomaticBusy(false); }
          }}>{t("backup.now")}</Button>
          <Button variant="secondary" disabled={automaticBusy || importing || !automaticStatus?.latestDay} onClick={async () => {
            setAutomaticBusy(true);
            try {
              const content = await invoke<string>("crm_backup_latest");
              await onPickImport(new File([content], "automatic-backup.json", { type: "application/json" }));
            } catch (e) { pushToast(String(e), "error"); }
            finally { setAutomaticBusy(false); }
          }}>{t("backup.restoreLatest")}</Button>
        </div>
      </section>}

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
        <SectionLabel>{t("settingsData.privacy")}</SectionLabel>
        <ul className="mt-3 space-y-2 text-[11px] leading-5 text-zinc-400">
          <li className="flex gap-2">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand" />
            <span>
              {t("settingsData.privacyLocal")}
            </span>
          </li>
          <li className="flex gap-2">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand" />
            <span>
              {t("settingsData.privacyKeys")}
            </span>
          </li>
          <li className="flex gap-2">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand" />
            <span>
              {t("settingsData.privacyCredentials")}
            </span>
          </li>
          <li className="flex gap-2">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand" />
            <span>{t("settingsData.privacyBackup")}</span>
          </li>
        </ul>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
        <SectionLabel>{t("settingsData.localData")}</SectionLabel>
        <p className="mt-3 rounded-lg bg-zinc-900 px-3 py-2 text-[11px] text-zinc-400">
          {dbLabel || t("settingsData.checking")}
        </p>
        <p className="mt-2 text-2xs leading-4 text-zinc-600">
          {t("settingsData.storageHint")}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm" className="text-2xs"
            disabled={exporting || importing}
            onClick={() => void onExport()}
          >
            {exporting ? t("settingsData.exporting") : t("settingsData.exportJson")}
          </Button>
          <Button
            variant="secondary"
            size="sm" className="text-2xs"
            disabled={importing || exporting}
            onClick={() => fileRef.current?.click()}
          >
            {importing ? t("settingsData.restoring") : t("settingsData.importJson")}
          </Button>
          <Button
            variant="secondary"
            size="sm" className="text-2xs"
            onClick={exportContactsCsv}
          >
            {t("settingsData.exportCsv")}
          </Button>
          <Button
            variant="secondary"
            size="sm" className="text-2xs"
            onClick={() => setImportOpen(true)}
          >
            {t("settingsData.importContacts")}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => void onPickImport(e.target.files?.[0] || null)}
          />
        </div>
        <label className="mt-3 flex items-center gap-2 text-2xs text-zinc-400">
          <input type="checkbox" checked={includeMedia} disabled={exporting || importing}
            onChange={(event) => setIncludeMedia(event.target.checked)} />
          {t("settingsData.includeMedia")}
        </label>
        {lastBackup && <p className="mt-2 text-2xs text-zinc-500">
          {t("settingsData.lastBackup", { time: new Date(lastBackup).toLocaleString() })}
        </p>}
        <p className="mt-2 text-2xs text-zinc-600">
          {t("settingsData.backupHint")}
        </p>
      </section>

      <ContactImportModal open={importOpen} onClose={() => setImportOpen(false)} />

      <section className="rounded-xl border border-amber-900/50 bg-amber-950/10 p-4">
        <SectionLabel>{t("settingsData.releaseHistory")}</SectionLabel>
        <p className="mt-2 text-[11px] leading-5 text-zinc-400">
          {t("settingsData.releaseDescription")}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="text-2xs text-zinc-500" htmlFor="release-days">
            {t("settingsData.olderThan")}
          </label>
          <select
            id="release-days"
            value={releaseDays}
            onChange={(event) => setReleaseDays(Number(event.target.value))}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-2xs text-zinc-200 outline-none"
          >
            <option value={90}>{t("settingsData.days", { count: 90 })}</option>
            <option value={180}>{t("settingsData.days", { count: 180 })}</option>
            <option value={365}>{t("settingsData.days", { count: 365 })}</option>
          </select>
          <span className="text-2xs text-zinc-500">
            {t("settingsData.releasable", { count: inactiveChats.length })}
          </span>
        </div>
        <p className="mt-2 text-2xs leading-4 text-zinc-600">
          {t("settingsData.releaseHint")}
        </p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-3 border-amber-900/50 text-2xs text-amber-200 hover:bg-amber-950/40"
          disabled={importing || exporting || releasingHistory || inactiveChats.length === 0}
          onClick={() => {
            void (async () => {
              const ok = await requestConfirm({
                title: t("settingsData.releaseTitle", { count: inactiveChats.length }),
                description: t("settingsData.releaseConfirmDescription"),
                confirmLabel: t("settingsData.releaseConfirm"),
                cancelLabel: t("common.cancel"),
                tone: "danger",
              });
              if (!ok) return;
              setReleasingHistory(true);
              try {
                const count = await releaseInactiveChatHistory(
                  inactiveChats.map((chat) => chat.id)
                );
                pushToast(t("settingsData.released", { count }), "success");
              } catch (e) {
                pushToast(
                  e instanceof Error ? e.message : t("settingsData.releaseFailed"),
                  "error"
                );
              } finally {
                setReleasingHistory(false);
              }
            })();
          }}
        >
          {releasingHistory ? t("settingsData.releasing") : t("settingsData.releaseButton")}
        </Button>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
        <SectionLabel>{t("settingsData.mediaCache")}</SectionLabel>
        <p className="mt-2 text-[11px] leading-5 text-zinc-500">
          {t("settingsData.mediaDescription")}
        </p>
        <p className="mt-2 text-2xs text-zinc-500">
          {mediaCacheStats
            ? t("settingsData.mediaUsage", {
                used: formatCacheSize(mediaCacheStats.chars),
                limit: formatCacheSize(mediaCacheStats.limitChars),
                items: mediaCacheStats.items,
              })
            : t("settingsData.checking")}
        </p>
        <Button
          variant="secondary"
          size="sm" className="mt-3 text-2xs"
          disabled={importing || exporting || clearingMedia}
          onClick={() => {
            void (async () => {
              const ok = await requestConfirm({
                title: t("settingsData.clearMediaTitle"),
                description: t("settingsData.clearMediaDescription"),
                confirmLabel: t("settingsData.clearCache"),
                cancelLabel: t("common.cancel"),
              });
              if (!ok) return;
              setClearingMedia(true);
              try {
                const count = await clearMediaCache();
                setMediaCacheStats(await getMediaCacheStats());
                pushToast(t("settingsData.mediaCleared", { count }), "success");
              } catch (e) {
                pushToast(e instanceof Error ? e.message : t("settingsData.mediaClearFailed"), "error");
              } finally {
                setClearingMedia(false);
              }
            })();
          }}
        >
          {clearingMedia ? t("settingsData.clearing") : t("settingsData.clearMedia")}
        </Button>
      </section>

      <section className="rounded-xl border border-red-950/60 bg-red-950/10 p-4">
        <SectionLabel>{t("settingsData.danger")}</SectionLabel>
        <p className="mt-2 text-[11px] text-zinc-500">
          {t("settingsData.dangerHint")}
        </p>
        <Button
          variant="secondary"
          size="sm" className="mt-3 border-red-900/50 text-2xs text-red-300 hover:bg-red-950/40"
          disabled={importing || exporting || clearingData}
          onClick={() => {
            void (async () => {
              const ok = await useAppStore.getState().requestConfirm({
                title: t("settingsData.clearTitle"),
                description: t("settingsData.clearDescription"),
                confirmLabel: t("settingsData.clearConfirm"),
                cancelLabel: t("common.cancel"),
                tone: "danger",
              });
              if (!ok) return;
              setClearingData(true);
              try {
                await clearData();
                pushToast(t("settingsData.cleared"), "success");
              } catch (e) {
                pushToast(e instanceof Error ? e.message : t("settingsData.clearFailed"), "error");
              } finally {
                setClearingData(false);
              }
            })();
          }}
        >
          {clearingData ? t("settingsData.clearingData") : t("settingsData.clearLocal")}
        </Button>
      </section>
    </div>
  );
}
