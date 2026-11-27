import { Languages, Settings2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { useAppStore } from "@/store/appStore";
import { Switch } from "@/components/ui/primitives";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

export function TranslationQuickSettingsPopover({
  onClose,
  onOpenSettings,
  above = false,
}: {
  onClose: () => void;
  onOpenSettings: () => void;
  above?: boolean;
}) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);

  useEffect(() => {
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  const toggle = (key: "autoDetectContactLanguage" | "incomingTranslateEnabled" | "backTranslate" | "emojiEnabled" | "enterTranslateSend", value: boolean) => {
    updateSettings({ [key]: value });
  };

  return (
    <div ref={rootRef} role="dialog" aria-label={t("translation.quickSettings")} className={cn("absolute right-0 z-50 w-72 rounded-xl border border-zinc-700 bg-zinc-900 p-2.5 text-zinc-200 shadow-2xl shadow-black/40", above ? "bottom-full mb-2" : "top-full mt-2")}>
      <div className="mb-1.5 flex items-center gap-2 border-b border-zinc-800 px-1 pb-1.5">
        <Languages className="h-4 w-4 text-brand" />
        <span className="text-[13px] font-semibold">{t("translation.quickSettings")}</span>
      </div>
      <div className="space-y-0.5">
        <QuickSetting
          label={t("settings.autoDetectContactLanguage")}
          checked={settings.autoDetectContactLanguage !== false}
          onChange={(value) => toggle("autoDetectContactLanguage", value)}
        />
        <QuickSetting
          label={t("settings.autoTranslate")}
          checked={settings.incomingTranslateEnabled === true}
          onChange={(value) => toggle("incomingTranslateEnabled", value)}
        />
        <QuickSetting
          label={t("settings.backTranslate")}
          checked={settings.backTranslate !== false}
          onChange={(value) => toggle("backTranslate", value)}
        />
        <QuickSetting
          label={t("settings.enterToSend")}
          checked={settings.enterTranslateSend === true}
          onChange={(value) => toggle("enterTranslateSend", value)}
        />
        <QuickSetting
          label={t("settings.emojiEnabled")}
          checked={settings.emojiEnabled !== false}
          onChange={(value) => toggle("emojiEnabled", value)}
        />
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 border-t border-zinc-800 px-1 pt-2.5">
        <label className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] text-zinc-500">
          <span className="shrink-0 whitespace-nowrap">{t("settingsMessaging.defaultTargetLanguage")}</span>
          <select
            value={settings.translateTargetLang || "en"}
            onChange={(event) => updateSettings({ translateTargetLang: event.target.value })}
            className="ui-control min-w-0 flex-1 px-2 text-[12px]"
          >
            <option value="en">English</option>
            <option value="zh">中文</option>
            <option value="fr">Français</option>
            <option value="es">Español</option>
            <option value="de">Deutsch</option>
            <option value="pt">Português</option>
            <option value="ru">Русский</option>
            <option value="ar">العربية</option>
            <option value="sw">Kiswahili</option>
            <option value="hy">Հայերեն</option>
            <option value="hi">हिन्दी</option>
            <option value="id">Bahasa Indonesia</option>
            <option value="ja">日本語</option>
            <option value="ko">한국어</option>
          </select>
        </label>
        <button type="button" onClick={onOpenSettings} aria-label={t("translation.openSettings")} title={t("translation.openSettings")} className="flex shrink-0 items-center gap-1 rounded-lg border border-zinc-700 px-2 py-1.5 text-[11px] text-zinc-400 hover:border-brand/50 hover:text-brand">
          <Settings2 className="h-3.5 w-3.5" />
          <span>{t("translation.openSettings")}</span>
        </button>
      </div>
    </div>
  );
}

function QuickSetting({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  const { t } = useI18n();
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-1.5 py-1.5 text-[12px] hover:bg-zinc-800/70">
      <span>{label}</span>
      <span className="flex items-center gap-2">
        <span className={checked ? "text-brand" : "text-zinc-600"}>{t(checked ? "settings.quickOn" : "settings.quickOff")}</span>
        <Switch checked={checked} onChange={(event) => onChange(event.target.checked)} />
      </span>
    </label>
  );
}
