import {
  AudioLines,
  Bot,
  Clock3,
  Database,
  Info,
  MessageSquareText,
  Palette,
  Radio,
  ShieldBan,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { useI18n, type TranslationKey } from "@/i18n";
import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { SettingsConnectionPanel } from "./SettingsConnectionPanel";
import { SettingsMessagingPanel } from "./SettingsMessagingPanel";
import { SettingsAiPanel } from "./SettingsAiPanel";
import { SettingsAutoReplyPanel } from "./SettingsAutoReplyPanel";
import { SettingsQuickRepliesPanel } from "./SettingsQuickRepliesPanel";
import { SettingsDataPanel } from "./SettingsDataPanel";
import { SettingsBlocklistPanel } from "./SettingsBlocklistPanel";
import { SettingsAppearancePanel } from "./SettingsAppearancePanel";
import { SettingsLocalSpeechPanel } from "./SettingsLocalSpeechPanel";
import { SettingsScheduledMessagesPanel } from "./SettingsScheduledMessagesPanel";
import { SettingsUpdatePanel } from "./SettingsUpdatePanel";
import { memo, useState, type ComponentType } from "react";

const CATEGORIES = [
  { id: "connection", labelKey: "settings.connection", descriptionKey: "settings.connectionDesc", icon: Radio },
  { id: "messaging", labelKey: "settings.messaging", descriptionKey: "settings.messagingDesc", icon: MessageSquareText },
  { id: "blocklist", labelKey: "settings.blocklist", descriptionKey: "settings.blocklistDesc", icon: ShieldBan },
  { id: "ai", labelKey: "settings.ai", descriptionKey: "settings.aiDesc", icon: Bot },
  { id: "local-speech", labelKey: "settings.localSpeech", descriptionKey: "settings.localSpeechDesc", icon: AudioLines },
  { id: "auto-reply", labelKey: "settings.autoReply", descriptionKey: "settings.autoReplyDesc", icon: Workflow },
  { id: "scheduled", labelKey: "settings.scheduled", descriptionKey: "settings.scheduledDesc", icon: Clock3 },
  { id: "quick-replies", labelKey: "settings.quickReplies", descriptionKey: "settings.quickRepliesDesc", icon: Zap },
  { id: "appearance", labelKey: "settings.appearance", descriptionKey: "settings.appearanceDesc", icon: Palette },
  { id: "data", labelKey: "settings.data", descriptionKey: "settings.dataDesc", icon: Database },
  { id: "updates", labelKey: "settings.updates", descriptionKey: "settings.updatesDesc", icon: Info },
] as const;

type CategoryId = (typeof CATEGORIES)[number]["id"];

const PANEL_COMPONENTS: Record<CategoryId, ComponentType> = {
  connection: SettingsConnectionPanel,
  messaging: SettingsMessagingPanel,
  blocklist: SettingsBlocklistPanel,
  ai: SettingsAiPanel,
  "local-speech": SettingsLocalSpeechPanel,
  "auto-reply": SettingsAutoReplyPanel,
  scheduled: SettingsScheduledMessagesPanel,
  "quick-replies": SettingsQuickRepliesPanel,
  appearance: SettingsAppearancePanel,
  data: SettingsDataPanel,
  updates: SettingsUpdatePanel,
};

const KeepAlivePanel = memo(function KeepAlivePanel({
  active,
  Panel,
}: {
  active: boolean;
  Panel: ComponentType;
}) {
  return (
    <div hidden={!active} aria-hidden={!active}>
      <Panel />
    </div>
  );
});

export function SettingsModal() {
  const { t } = useI18n();
  const open = useAppStore((state) => state.settingsOpen);
  const setOpen = useAppStore((state) => state.setSettingsOpen);
  const category = useAppStore((state) => state.settingsCategory) as CategoryId;
  const setCategory = useAppStore((state) => state.setSettingsCategory);
  const [visited, setVisited] = useState(() => new Set<CategoryId>([category]));

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
      onClick={() => setOpen(false)}
    >
      <div
        className="flex min-h-0 flex-none flex-col overflow-hidden rounded-2xl border border-zinc-700/90 bg-zinc-900 shadow-2xl"
        style={{ width: "min(92vw, 1152px)", height: "min(82vh, 780px)" }}
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.title")}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-800 px-6">
          <h2 className="text-[17px] font-semibold leading-none text-zinc-100">{t("settings.title")}</h2>
          <Button
            variant="ghost"
            className="w-9 !px-0"
            onClick={() => setOpen(false)}
            title={t("settings.close")}
          >
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="flex min-h-0 flex-1">
          <nav className="w-60 shrink-0 overflow-y-auto border-r border-zinc-800 bg-zinc-950/45 p-3" aria-label={t("settings.categories")}>
            <div className="space-y-1">
              {CATEGORIES.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectCategory(item.id)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                      category === item.id
                        ? "bg-zinc-800 text-zinc-100"
                        : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
                    )}
                  >
                    <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", category === item.id && "text-brand")} />
                    <span className="min-w-0">
                      <span className="block break-words text-[12px] font-medium">{t(item.labelKey as TranslationKey)}</span>
                      <span className="mt-0.5 block break-words text-2xs leading-3 text-zinc-600">{t(item.descriptionKey as TranslationKey)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </nav>

          <main className="min-w-0 flex-1 overflow-y-auto p-6">
            {CATEGORIES.map((item) =>
              visited.has(item.id) ? (
                <KeepAlivePanel
                  key={item.id}
                  active={category === item.id}
                  Panel={PANEL_COMPONENTS[item.id]}
                />
              ) : null
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
