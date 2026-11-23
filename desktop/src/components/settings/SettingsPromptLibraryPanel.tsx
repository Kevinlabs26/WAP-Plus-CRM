import { useI18n } from "@/i18n";
import { AiPromptLibrary } from "./AiPromptLibrary";

export function SettingsPromptLibraryPanel() {
  const { t } = useI18n();

  return <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col">
    <h3 className="shrink-0 pb-3 text-lg font-semibold">{t("aiLibrary.title")}</h3>
    <AiPromptLibrary initiallyOpen fill />
  </div>;
}
