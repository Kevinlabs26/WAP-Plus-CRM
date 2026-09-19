import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "@/store/appStore";
import { Button, SectionLabel } from "@/components/ui/primitives";
import { getDbInfo, getStorageEngine, resolveStorageEngine } from "@/lib/storage";
import { clearMediaCache } from "@/lib/mediaCache";
import { findInactiveChats } from "@/lib/inactiveChatCleanup";
import { ContactImportModal } from "./ContactImportModal";
import { useI18n } from "@/i18n";

export function SettingsDataPanel() {
  const { t } = useI18n();
  const clearData = useAppStore((state) => state.clearData);
  const exportBackup = useAppStore((state) => state.exportBackup);
  const exportContactsCsv = useAppStore((state) => state.exportContactsCsv);
  const importBackup = useAppStore((state) => state.importBackup);
  const pushToast = useAppStore((state) => state.pushToast);
  const requestConfirm = useAppStore((state) => state.requestConfirm);
  const [dbLabel, setDbLabel] = useState("");
  const [importing, setImporting] = useState(false);
  const [clearingMedia, setClearingMedia] = useState(false);
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
    })();
  }, [t]);

  const onPickImport = async (file: File | null) => {
    if (!file) return;
    const ok = await requestConfirm({
      title: t("settingsData.restoreTitle"),
      description: t("settingsData.restoreDescription"),
      confirmLabel: t("settingsData.restoreConfirm"),
      cancelLabel: t("common.cancel"),
      tone: "danger",
    });
    if (!ok) return;
    setImporting(true);
    try {
      const result = await importBackup(file);
      if (!result.ok) throw new Error(result.reason || t("settingsData.restoreFailed"));
      pushToast(t("settingsData.restoreDone"), "success");
    } catch (e) {
      pushToast(e instanceof Error ? e.message : t("settingsData.restoreFailed"), "error");
    } finally {
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
            onClick={exportBackup}
          >
            {t("settingsData.exportJson")}
          </Button>
          <Button
            variant="secondary"
            size="sm" className="text-2xs"
            disabled={importing}
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
          disabled={releasingHistory || inactiveChats.length === 0}
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
        <Button
          variant="secondary"
          size="sm" className="mt-3 text-2xs"
          disabled={clearingMedia}
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
          disabled={clearingData}
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
