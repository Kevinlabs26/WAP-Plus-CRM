import {
  AudioLines,
  Bot,
  Bell,
  Clock3,
  Database,
  Info,
  MessageSquareText,
  Palette,
  Radio,
  ShieldBan,
  TableProperties,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { useI18n, type TranslationKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { SettingsConnectionPanel } from "./SettingsConnectionPanel";
import { SettingsMessagingPanel } from "./SettingsMessagingPanel";
import { SettingsAiPanel } from "./SettingsAiPanel";
import { SettingsAutoReplyPanel } from "./SettingsAutoReplyPanel";
import { SettingsQuickRepliesPanel } from "./SettingsQuickRepliesPanel";
import { SettingsDataPanel } from "./SettingsDataPanel";
import { SettingsGoogleSheets, type SheetCloseGuard } from "./SettingsGoogleSheets";
import { SettingsBlocklistPanel } from "./SettingsBlocklistPanel";
import { SettingsAppearancePanel } from "./SettingsAppearancePanel";
import { SettingsSpeechPanel } from "./SettingsSpeechPanel";
import { SettingsNotificationsPanel } from "./SettingsNotificationsPanel";
import { SettingsScheduledMessagesPanel } from "./SettingsScheduledMessagesPanel";
import { SettingsUpdatePanel } from "./SettingsUpdatePanel";
import { memo, useEffect, useRef, useState, type ComponentType } from "react";

const CATEGORIES = [
  { id: "connection", labelKey: "settings.connection", descriptionKey: "settings.connectionDesc", icon: Radio },
  { id: "messaging", labelKey: "settings.messaging", descriptionKey: "settings.messagingDesc", icon: MessageSquareText },
  { id: "notifications", labelKey: "settings.notifications", descriptionKey: "settings.notificationsDesc", icon: Bell },
  { id: "blocklist", labelKey: "settings.blocklist", descriptionKey: "settings.blocklistDesc", icon: ShieldBan },
  { id: "ai", labelKey: "settings.ai", descriptionKey: "settings.aiDesc", icon: Bot },
  { id: "local-speech", labelKey: "settings.localSpeech", descriptionKey: "settings.localSpeechDesc", icon: AudioLines },
  { id: "auto-reply", labelKey: "settings.autoReply", descriptionKey: "settings.autoReplyDesc", icon: Workflow },
  { id: "scheduled", labelKey: "settings.scheduled", descriptionKey: "settings.scheduledDesc", icon: Clock3 },
  { id: "quick-replies", labelKey: "settings.quickReplies", descriptionKey: "settings.quickRepliesDesc", icon: Zap },
  { id: "google-sheets", labelKey: "settings.googleSheets", descriptionKey: "settings.googleSheetsDesc", icon: TableProperties },
  { id: "data", labelKey: "settings.data", descriptionKey: "settings.dataDesc", icon: Database },
  { id: "appearance", labelKey: "settings.appearance", descriptionKey: "settings.appearanceDesc", icon: Palette },
  { id: "updates", labelKey: "settings.updates", descriptionKey: "settings.updatesDesc", icon: Info },
] as const;

type CategoryId = (typeof CATEGORIES)[number]["id"];
const GROUP_LABELS: Partial<Record<CategoryId, TranslationKey>> = {
  connection: "settings.group.communication",
  ai: "settings.group.intelligence",
  scheduled: "settings.group.tools",
  "google-sheets": "settings.group.data",
  appearance: "settings.group.application",
};
const AUTO_SAVE_CATEGORIES: CategoryId[] = ["connection", "messaging", "notifications", "ai", "local-speech", "auto-reply", "appearance"];

const PANEL_COMPONENTS: Record<CategoryId, ComponentType> = {
  connection: SettingsConnectionPanel,
  messaging: SettingsMessagingPanel,
  blocklist: SettingsBlocklistPanel,
  ai: SettingsAiPanel,
  "local-speech": SettingsSpeechPanel,
  notifications: SettingsNotificationsPanel,
  "auto-reply": SettingsAutoReplyPanel,
  scheduled: SettingsScheduledMessagesPanel,
  "quick-replies": SettingsQuickRepliesPanel,
  appearance: SettingsAppearancePanel,
  data: SettingsDataPanel,
  "google-sheets": SettingsGoogleSheets,
  updates: SettingsUpdatePanel,
};

const KeepAlivePanel = memo(function KeepAlivePanel({
  active,
  Panel,
  onCloseGuardChange,
}: {
  active: boolean;
  Panel: ComponentType;
  onCloseGuardChange: (guard: SheetCloseGuard | null) => void;
}) {
  return (
    <div hidden={!active} aria-hidden={!active}>
      {Panel === SettingsGoogleSheets ? <SettingsGoogleSheets onCloseGuardChange={onCloseGuardChange} /> : <Panel />}
    </div>
  );
});

export function SettingsModal() {
  const { t } = useI18n();
  const open = useAppStore((state) => state.settingsOpen);
  const setOpen = useAppStore((state) => state.setSettingsOpen);
  const secretSaveStatus = useAppStore(state => state.secretSaveStatus);
  const retrySecretSave = useAppStore(state => state.retrySecretSave);
  const category = useAppStore((state) => state.settingsCategory) as CategoryId;
  const setCategory = useAppStore((state) => state.setSettingsCategory);
  const [visited, setVisited] = useState(() => new Set<CategoryId>([category]));
  const closeRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  const [closeGuard, setCloseGuard] = useState<SheetCloseGuard | null>(null);
  const [closePrompt, setClosePrompt] = useState(false);
  const [savingClose, setSavingClose] = useState(false);
  const keepEditingRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    closeRef.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [open]);

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [category]);
  useEffect(() => { if (closePrompt) keepEditingRef.current?.focus(); }, [closePrompt]);
  const requestClose = () => {
    if (closeGuard?.dirty || closeGuard?.busy) setClosePrompt(true);
    else setOpen(false);
  };

  const selectCategory = (next: CategoryId) => {
    setVisited((current) => {
      if (current.has(next)) return current;
      return new Set(current).add(next);
    });
    setCategory(next);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-6 backdrop-blur-[2px]"
      onClick={requestClose}
    >
      <div
        className="flex min-h-0 flex-none flex-col overflow-hidden rounded-2xl border border-zinc-700/90 bg-zinc-900 shadow-2xl"
        style={{ width: "min(94vw, 1152px)", height: "min(88vh, 820px)" }}
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.title")}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          // Nested dialogs handle their own keys; global confirmations live outside this panel.
          if (event.defaultPrevented || (event.target as HTMLElement).closest('[role="dialog"], [role="alertdialog"]') !== event.currentTarget) return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            requestClose();
          } else if (event.key === "Tab") {
            const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]'
            )).filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0);
            const first = controls[0], last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-800 px-6">
          <h2 className="text-[17px] font-semibold leading-none text-zinc-100">{t("settings.title")}</h2>
          <button
            ref={closeRef}
            type="button"
            className="ui-btn-ghost h-9 w-9 !px-0"
            onClick={requestClose}
            title={t("settings.close")}
            aria-label={t("settings.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <nav className="w-60 shrink-0 overflow-y-auto border-r border-zinc-800 bg-zinc-950/45 p-3" aria-label={t("settings.categories")}>
            <div className="space-y-1">
              {CATEGORIES.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.id}>
                  {GROUP_LABELS[item.id] && <p className="px-3 pb-1 pt-3 text-[10px] font-medium text-zinc-500">{t(GROUP_LABELS[item.id]!)}</p>}
                  <button
                    type="button"
                    onClick={() => selectCategory(item.id)}
                    aria-current={category === item.id ? "page" : undefined}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                      category === item.id
                        ? "bg-zinc-800 text-zinc-100"
                        : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
                    )}
                  >
                    <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", category === item.id && "text-brand")} />
                    <span className="min-w-0">
                      <span className="block break-words text-[13px] font-medium">{t(item.labelKey as TranslationKey)}</span>
                      <span className="mt-0.5 block break-words text-2xs leading-4 text-zinc-600">{t(item.descriptionKey as TranslationKey)}</span>
                    </span>
                  </button>
                  </div>
                );
              })}
            </div>
          </nav>

          <main ref={contentRef} className="min-w-0 flex-1 overflow-y-auto p-6">
            {secretSaveStatus === "failed" && <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-400"><p>{t("settings.secretSaveFailed")}</p><button type="button" className="ui-btn-secondary" onClick={() => void retrySecretSave()}>{t("settings.retrySecretSave")}</button></div>}
            {secretSaveStatus === "saving" && <p role="status" className="mb-3 text-xs text-zinc-500">{t("settings.secretSaving")}</p>}
            {AUTO_SAVE_CATEGORIES.includes(category) && <p className="mb-4 rounded-lg border border-zinc-800 px-3 py-2 text-xs leading-5 text-zinc-500">{t("settings.autoSaveHint")}</p>}
            {CATEGORIES.map((item) =>
              visited.has(item.id) ? (
                <KeepAlivePanel
                  key={item.id}
                  active={category === item.id}
                  Panel={PANEL_COMPONENTS[item.id]}
                  onCloseGuardChange={setCloseGuard}
                />
              ) : null
            )}
          </main>
        </div>
      </div>
      {closePrompt && <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/60 p-4" onClick={event => event.stopPropagation()}>
        <div role="alertdialog" aria-modal="true" aria-labelledby="settings-unsaved-title" aria-describedby="settings-unsaved-description" className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl"
          onKeyDown={event => {
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!savingClose) { setClosePrompt(false); closeRef.current?.focus(); } }
            if (event.key === "Tab") {
              const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
              if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
              else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
            }
          }}>
          <h3 id="settings-unsaved-title" className="font-semibold text-zinc-100">{t("settings.unsavedTitle")}</h3>
          <p id="settings-unsaved-description" className="mt-2 text-xs leading-5 text-zinc-400">{t(closeGuard?.busy ? "settings.waitForOperation" : "settings.unsavedDescription")}</p>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button ref={keepEditingRef} type="button" className="ui-btn-secondary" disabled={savingClose} onClick={() => { setClosePrompt(false); closeRef.current?.focus(); }}>{t("settings.keepEditing")}</button>
            <button type="button" className="ui-btn-ghost" disabled={savingClose || closeGuard?.busy} onClick={() => setOpen(false)}>{t("settings.discardClose")}</button>
            <button type="button" className="ui-btn-primary" disabled={savingClose || closeGuard?.busy || !closeGuard?.canSave} onClick={async () => {
              setSavingClose(true);
              try { if (await closeGuard?.save()) setOpen(false); else { setClosePrompt(false); selectCategory("google-sheets"); } }
              finally { setSavingClose(false); }
            }}>{t(savingClose ? "sheets.saving" : "settings.saveClose")}</button>
          </div>
        </div>
      </div>}
    </div>
  );
}
