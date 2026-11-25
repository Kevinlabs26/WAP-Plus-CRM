import { useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/store/appStore";
import { ContactImportModal } from "@/components/settings/ContactImportModal";
import { DuplicateContactsCleanupModal } from "@/components/settings/DuplicateContactsCleanupModal";
import { ContactsTableToolbar } from "./ContactsTableToolbar";
import { ContactsTableBatchBar } from "./ContactsTableBatchBar";
import { CONTACTS_TABLE_GRID, ContactsTableRow } from "./ContactsTableRow";
import {
  createDefaultContactsFilter,
  queryContactsTable,
  type ContactsTableFilterState,
} from "@/lib/contactsTableQuery";
import { runBatchCloudContactSave } from "@/lib/contactsTableActions";
import { findDuplicateContactGroups } from "@/lib/contactDeduplication";
import { salesStagesWithLabels } from "@/lib/contactWorkflow";
import { formatAccountDisplay } from "@/lib/accountLabels";
import { isWaAccountConnected } from "@/lib/accountConnection";
import { contactsToCsv, downloadText } from "@/lib/exportData";
import { useI18n } from "@/i18n";

/** Full-width virtualized CRM contacts table with multi-dimensional filters and batch actions. */
export function ContactsView() {
  const { t } = useI18n();
  const {
    contacts,
    chats,
    followUps,
    waAccounts,
    baileysConnection,
    sendChannel,
    liveAccountId,
    activeAccountId,
    salesStageLabels,
    salesStageOrder,
  } = useAppStore(
    useShallow((state) => ({
      contacts: state.contacts,
      chats: state.chats,
      followUps: state.followUps,
      waAccounts: state.settings.waAccounts || [],
      baileysConnection: state.baileysUi.connection,
      sendChannel: state.settings.sendChannel,
      liveAccountId: state.settings.liveBaileysAccountId,
      activeAccountId: state.settings.activeAccountId,
      salesStageLabels: state.settings.salesStageLabels,
      salesStageOrder: state.settings.salesStageOrder,
    }))
  );

  const isBaileys = sendChannel !== "android_bridge";
  const defaultAccountId = liveAccountId || activeAccountId || waAccounts[0]?.id || "";
  const [filter, setFilter] = useState<ContactsTableFilterState>(() =>
    createDefaultContactsFilter("")
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [cloudTarget, setCloudTarget] = useState(defaultAccountId);
  const [importOpen, setImportOpen] = useState(false);
  const [dedupeOpen, setDedupeOpen] = useState(false);
  const [savingCloud, setSavingCloud] = useState(false);
  const savingCloudRef = useRef(false);

  const connectedAccountIds = useMemo(
    () =>
      waAccounts
        .filter((account) =>
          isWaAccountConnected(waAccounts, account.id, liveAccountId, baileysConnection)
        )
        .map((account) => account.id),
    [waAccounts, liveAccountId, baileysConnection]
  );

  useEffect(() => {
    if (!cloudTarget || !waAccounts.some((account) => account.id === cloudTarget)) {
      setCloudTarget(connectedAccountIds[0] || defaultAccountId);
    }
  }, [cloudTarget, waAccounts, connectedAccountIds, defaultAccountId]);

  const stages = useMemo(
    () => salesStagesWithLabels(salesStageLabels, salesStageOrder),
    [salesStageLabels, salesStageOrder]
  );

  const accountLabelById = useMemo(() => {
    const map = new Map<string, string>();
    waAccounts.forEach((account, index) => {
      map.set(account.id, formatAccountDisplay({ ...account, index1: index + 1 }));
    });
    return map;
  }, [waAccounts]);

  const queryResult = useMemo(
    () =>
      queryContactsTable({
        contacts,
        chats,
        followUps,
        filter,
        liveAccountId: liveAccountId || activeAccountId,
        stageOrder: stages.map((stage) => stage.id),
      }),
    [contacts, chats, followUps, filter, liveAccountId, activeAccountId, stages]
  );

  const duplicateGroups = useMemo(
    () =>
      findDuplicateContactGroups({
        contacts,
        chats,
        messages: useAppStore.getState().messages || [],
        accountId: filter.accountId || undefined,
        liveAccountId: liveAccountId || activeAccountId,
      }),
    [contacts, chats, filter.accountId, liveAccountId, activeAccountId]
  );
  const duplicateExtraCount = useMemo(
    () => duplicateGroups.reduce((sum, group) => sum + group.duplicates.length, 0),
    [duplicateGroups]
  );

  const visibleRowIds = useMemo(
    () => new Set(queryResult.rows.map((row) => row.contact.id)),
    [queryResult.rows]
  );
  const selectedRows = useMemo(
    () => queryResult.rows.filter((row) => selectedIds.has(row.contact.id)),
    [queryResult.rows, selectedIds]
  );
  const selectedContactIds = useMemo(
    () => selectedRows.map((row) => row.contact.id),
    [selectedRows]
  );
  const allVisibleSelected =
    queryResult.rows.length > 0 && selectedRows.length === queryResult.rows.length;

  const toggleRowSelection = (contactId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  };

  const toggleSelectAllVisible = (checked: boolean) => {
    setSelectedIds(checked ? new Set(visibleRowIds) : new Set());
  };

  const handleBatchSaveToCloud = async () => {
    if (savingCloudRef.current || !selectedRows.length) return;
    savingCloudRef.current = true;
    setSavingCloud(true);
    try {
      await runBatchCloudContactSave({
        selectedContacts: selectedRows.map((row) => row.contact),
        targetAccountId: cloudTarget,
        connectedAccountIds,
        translate: (key, params) => t(key as Parameters<typeof t>[0], params),
      });
    } catch (error) {
      useAppStore.getState().pushToast(String(error), "error");
    } finally {
      savingCloudRef.current = false;
      setSavingCloud(false);
    }
  };

  const handleBatchDelete = async () => {
    if (!selectedContactIds.length) return;
    const state = useAppStore.getState();
    const confirmed = await state.requestConfirm({
      title: t("contactManage.deleteTitle", { count: selectedContactIds.length }),
      description: t("contactManage.deleteHint"),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!confirmed) return;
    state.deleteContactsLocal(selectedContactIds);
    setSelectedIds(new Set());
  };

  const handleExportCsv = () => {
    const targets = selectedRows.length
      ? selectedRows.map((row) => row.contact)
      : queryResult.rows.map((row) => row.contact);
    downloadText(
      `contacts-${new Date().toISOString().slice(0, 10)}.csv`,
      `\ufeff${contactsToCsv(targets)}`,
      "text/csv;charset=utf-8"
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-zinc-950 text-zinc-100">
      <ContactsTableToolbar
        filter={filter}
        totalPeopleCount={queryResult.totalPeopleCount}
        filteredCount={queryResult.rows.length}
        selectedCount={selectedRows.length}
        pendingFollowUpCount={queryResult.pendingFollowUpCount}
        duplicateGroupCount={duplicateGroups.length}
        duplicateExtraCount={duplicateExtraCount}
        accounts={waAccounts}
        stages={stages}
        availableTags={queryResult.availableTags}
        isBaileys={isBaileys}
        busy={savingCloud}
        onFilterChange={(patch) => setFilter((prev) => ({ ...prev, ...patch }))}
        onResetFilters={() => setFilter(createDefaultContactsFilter(""))}
        onOpenImport={() => setImportOpen(true)}
        onOpenDedupe={() => setDedupeOpen(true)}
        onExportCsv={handleExportCsv}
      />

      <ContactsTableBatchBar
        selectedCount={selectedRows.length}
        stages={stages}
        accounts={waAccounts}
        connectedAccountIds={connectedAccountIds}
        isBaileys={isBaileys}
        cloudTargetAccountId={cloudTarget}
        savingCloud={savingCloud}
        onCloudTargetChange={setCloudTarget}
        onBatchSetStage={(stage) =>
          useAppStore.getState().batchUpdateContacts(selectedContactIds, { stage })
        }
        onBatchAddTag={(tag) =>
          useAppStore.getState().batchUpdateContacts(selectedContactIds, {}, { mergeTags: [tag] })
        }
        onBatchScheduleFollowUp={(dueAt) =>
          useAppStore.getState().scheduleFollowUps(selectedContactIds, dueAt)
        }
        onBatchSaveToCloud={() => void handleBatchSaveToCloud()}
        onBatchDelete={() => void handleBatchDelete()}
        onClearSelection={() => setSelectedIds(new Set())}
      />

      <div
        className={`grid shrink-0 ${CONTACTS_TABLE_GRID} items-center gap-3 border-b border-zinc-800 bg-zinc-900/70 px-6 py-2 text-[11px] font-semibold text-zinc-400`}
      >
        <input
          type="checkbox"
          aria-label={t("contactsTable.selectAll")}
          disabled={savingCloud || queryResult.rows.length === 0}
          checked={allVisibleSelected}
          onChange={(event) => toggleSelectAllVisible(event.target.checked)}
        />
        <span>{t("contactsTable.colContact")}</span>
        <span>{t("contactsTable.colPhone")}</span>
        <span>{t("contactsTable.colAccount")}</span>
        <span>{t("contactsTable.colStage")}</span>
        <span>{t("contactsTable.colTags")}</span>
        <span>{t("contactsTable.colActivity")}</span>
        <span className="text-right">{t("contactsTable.colAction")}</span>
      </div>

      {queryResult.rows.length > 0 ? (
        <Virtuoso
          className="min-h-0 flex-1"
          data={queryResult.rows}
          computeItemKey={(_, row) => row.contact.id}
          defaultItemHeight={56}
          itemContent={(_, row) => (
            <ContactsTableRow
              row={row}
              selected={selectedIds.has(row.contact.id)}
              accountLabel={accountLabelById.get(row.resolvedAccountId) || row.resolvedAccountId}
              stages={stages}
              disabled={savingCloud}
              onToggleSelect={toggleRowSelection}
            />
          )}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-[13px] text-zinc-500">
          {t("sidebar.noContacts")}
        </div>
      )}

      <ContactImportModal
        open={importOpen}
        accountId={isBaileys ? filter.accountId || defaultAccountId || undefined : undefined}
        onClose={() => setImportOpen(false)}
      />
      <DuplicateContactsCleanupModal
        open={dedupeOpen}
        accountId={filter.accountId || undefined}
        groups={duplicateGroups}
        onClose={() => setDedupeOpen(false)}
      />
    </div>
  );
}
