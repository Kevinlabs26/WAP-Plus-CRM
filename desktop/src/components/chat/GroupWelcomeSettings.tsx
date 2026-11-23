import { useId, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { groupWelcomeKey, MAX_WELCOME_IMAGE_BYTES, normalizeWelcomeImage, normalizeWelcomeTemplates } from "@/lib/groupWelcome";
import { useAppStore } from "@/store/appStore";

export function GroupWelcomeSettings({ accountId, groupJid }: { accountId: string; groupJid: string }) {
  const { t } = useI18n();
  const key = groupWelcomeKey(accountId, groupJid);
  const saved = useAppStore(state => state.settings.groupWelcomeRules?.[key]);
  const [enabled, setEnabled] = useState(saved?.enabled ?? false);
  const [drafts, setDrafts] = useState<{ id: number; text: string; imageDataUrl?: string }[]>(() =>
    (saved?.templates.length ? saved.templates : [""]).map((template, id) =>
      typeof template === "string" ? { id, text: template, imageDataUrl: undefined } : { id, ...template }
    )
  );
  const fieldId = useId();
  const nextId = useRef(drafts.length);
  const [reading, setReading] = useState(false);
  const [imageError, setImageError] = useState(false);
  const templates = normalizeWelcomeTemplates(drafts);
  const valid = !enabled || templates.length > 0;
  const dirty = enabled !== (saved?.enabled ?? false) || JSON.stringify(templates) !== JSON.stringify(saved?.templates ?? []);

  const attachImage = (id: number, file: File) => {
    setImageError(false);
    if (!file.size || file.size > MAX_WELCOME_IMAGE_BYTES || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setImageError(true);
      return;
    }
    const reader = new FileReader();
    setReading(true);
    reader.onloadend = () => {
      const imageDataUrl = normalizeWelcomeImage(reader.result);
      if (imageDataUrl) setDrafts(current => current.map(item => item.id === id ? { ...item, imageDataUrl } : item));
      else setImageError(true);
      setReading(false);
    };
    reader.readAsDataURL(file);
  };

  return <section className="mb-4 space-y-2 rounded-lg border border-zinc-800 p-3 text-xs">
    <label className="flex items-center gap-2 font-medium">
      <input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />
      {t("groupWelcome.enable")}
    </label>
    <fieldset className="space-y-2">
      <legend>{t("groupWelcome.templates")}</legend>
      {drafts.map((draft, index) => <div key={draft.id} className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={fieldId + "-" + draft.id}>{t("groupWelcome.version", { count: index + 1 })}</label>
          {drafts.length > 1 && <button type="button" className="ui-btn-secondary" onClick={() =>
            setDrafts(current => current.filter(item => item.id !== draft.id))
          }>{t("groupWelcome.removeVersion")}</button>}
        </div>
        <textarea id={fieldId + "-" + draft.id} className="ui-control min-h-20 w-full px-2 py-1.5"
          value={draft.text} maxLength={4000} onChange={event => {
            const text = event.target.value;
            setDrafts(current => current.map(item => item.id === draft.id ? { ...item, text } : item));
          }} />
        {draft.imageDataUrl && <img src={draft.imageDataUrl} alt={t("groupWelcome.imagePreview")} className="max-h-32 max-w-full rounded object-contain" />}
        <div className="flex flex-wrap items-center gap-2">
          <label className="ui-btn-secondary relative cursor-pointer focus-within:outline focus-within:outline-2">
            {t("groupWelcome.addImage")}
            <input type="file" className="sr-only" accept="image/jpeg,image/png,image/webp" disabled={reading}
              onChange={event => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) attachImage(draft.id, file);
              }} />
          </label>
          {draft.imageDataUrl && <button type="button" className="ui-btn-secondary" disabled={reading}
            onClick={() => setDrafts(current => current.map(item => item.id === draft.id ? { ...item, imageDataUrl: undefined } : item))}
          >{t("groupWelcome.removeImage")}</button>}
        </div>
      </div>)}
      <button type="button" className="ui-btn-secondary" disabled={drafts.length >= 20} onClick={() => {
        const id = nextId.current++;
        setDrafts(current => [...current, { id, text: "" }]);
      }}>{t("groupWelcome.addVersion")}</button>
    </fieldset>
    {imageError && <p role="alert">{t("groupWelcome.imageError")}</p>}
    <p className="text-zinc-500">{t("groupWelcome.hint")}</p>
    <button type="button" className="ui-btn-secondary" disabled={reading || !dirty || !valid} onClick={() => {
      const state = useAppStore.getState();
      state.updateSettings({
        groupWelcomeRules: { ...state.settings.groupWelcomeRules, [key]: { enabled, templates } },
      });
    }}>{t("dialog.save")}</button>
  </section>;
}
