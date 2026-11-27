import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button, Textarea } from "@/components/ui/primitives";
import { useI18n } from "@/i18n";
import { AI_BLOCKED_TERMS_MAX_LENGTH } from "@/lib/aiPrivacy";
import { useAppStore } from "@/store/appStore";

export function SettingsAiPrivacyPanel() {
  const { t } = useI18n();
  const terms = useAppStore(state => state.settings.museBlockedTerms);
  const updateSettings = useAppStore(state => state.updateSettings);
  const [visible, setVisible] = useState(false);
  const toggleLabel = t(visible ? "aiPrivacy.hide" : "aiPrivacy.show");
  const Icon = visible ? EyeOff : Eye;

  return <div className="mx-auto max-w-3xl space-y-4">
    <h3 className="text-lg font-semibold text-zinc-100">{t("aiPrivacy.title")}</h3>
    <section className="space-y-2" aria-labelledby="ai-blocked-terms-label">
      <div className="flex items-center justify-between gap-3">
        <label id="ai-blocked-terms-label" htmlFor={visible ? "ai-blocked-terms" : undefined} className="text-sm font-medium">{t("aiPrivacy.terms")}</label>
        <Button size="sm" className="w-8 justify-center !px-0" aria-label={toggleLabel} title={toggleLabel} onClick={() => setVisible(value => !value)}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      {visible ? <Textarea id="ai-blocked-terms" aria-describedby="ai-blocked-terms-hint" rows={4}
        maxLength={AI_BLOCKED_TERMS_MAX_LENGTH} value={terms} onChange={event => updateSettings({ museBlockedTerms: event.target.value })} />
        : <p className="ui-control px-3 py-2 text-sm text-zinc-500">{t(terms.trim() ? "aiPrivacy.hidden" : "aiPrivacy.empty")}</p>}
      <p id="ai-blocked-terms-hint" className="text-xs text-zinc-500">{t("aiPrivacy.hint")}</p>
    </section>
  </div>;
}
