import { useEffect, useId, useRef, useState } from "react";
import { ImageOff, ImagePlus, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/i18n";
import { groupWelcomeKey, MAX_WELCOME_IMAGE_BYTES, normalizeWelcomeImage, normalizeWelcomeTemplates } from "@/lib/groupWelcome";
import { useAppStore } from "@/store/appStore";

const versionActionClass = "ui-btn-ghost !min-h-0 h-7 w-7 !p-0 inline-flex items-center justify-center";

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
  const [activeId, setActiveId] = useState(0);
  const activeTab = useRef<HTMLButtonElement>(null);
  const focusNextTab = useRef(false);
  const [reading, setReading] = useState(false);
  const [imageError, setImageError] = useState(false);
  const templates = normalizeWelcomeTemplates(drafts);
  const valid = !enabled || templates.length > 0;
  const dirty = enabled !== (saved?.enabled ?? false) || JSON.stringify(templates) !== JSON.stringify(saved?.templates ?? []);

  useEffect(() => {
    if (!focusNextTab.current) return;
    focusNextTab.current = false;
    activeTab.current?.focus();
  }, [activeId]);

  const selectVersion = (id: number, moveFocus = false) => {
    if (id === activeId) return;
    focusNextTab.current = moveFocus;
    setActiveId(id);
    setImageError(false);
  };

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

  return <section className="space-y-2 p-4 text-xs">
    <label className="flex items-center gap-2 font-medium">
      <input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />
      {t("groupWelcome.enable")}
    </label>
    <fieldset className="space-y-2">
      <legend>{t("groupWelcome.templates")}</legend>
      <div className="flex items-center gap-2">
        <div role="tablist" aria-label={t("groupWelcome.templates")} className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1 py-1">
          {drafts.map((draft, index) => {
            const active = draft.id === activeId;
            return <button key={draft.id} ref={active ? activeTab : undefined} type="button" role="tab"
              id={`${fieldId}-tab-${draft.id}`} aria-controls={`${fieldId}-panel-${draft.id}`} aria-selected={active}
              tabIndex={active ? 0 : -1}
              className={`shrink-0 rounded-md px-2.5 py-1.5 text-xs ${active ? "bg-brand/15 font-medium text-brand" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"}`}
              onClick={() => selectVersion(draft.id)}
              onKeyDown={event => {
                const length = drafts.length;
                const next = event.key === "ArrowRight" ? (index + 1) % length
                  : event.key === "ArrowLeft" ? (index + length - 1) % length
                  : event.key === "Home" ? 0 : event.key === "End" ? length - 1 : -1;
                if (next < 0) return;
                event.preventDefault();
                selectVersion(drafts[next].id, true);
              }}>
              {t("groupWelcome.version", { count: index + 1 })}
            </button>;
          })}
        </div>
        <button type="button" className={`${versionActionClass} shrink-0`} disabled={drafts.length >= 20}
          title={t("groupWelcome.addVersion")} aria-label={t("groupWelcome.addVersion")} onClick={() => {
            const id = nextId.current++;
            setDrafts(current => [...current, { id, text: "" }]);
            selectVersion(id, true);
          }}><Plus className="h-4 w-4" aria-hidden="true" /></button>
      </div>
      {drafts.map((draft, index) => <div key={draft.id} role="tabpanel" id={`${fieldId}-panel-${draft.id}`}
        aria-labelledby={`${fieldId}-tab-${draft.id}`} hidden={draft.id !== activeId} className="space-y-1">
        {draft.id === activeId && <>
        <div className="flex items-center justify-end gap-2">
          <label className="sr-only" htmlFor={fieldId + "-" + draft.id}>{t("groupWelcome.version", { count: index + 1 })}</label>
          <div className="flex shrink-0 items-center gap-1">
            <label title={t("groupWelcome.addImage")} className={`${versionActionClass} relative focus-within:outline focus-within:outline-2 ${reading ? "opacity-50" : "cursor-pointer"}`}>
              <ImagePlus className="h-4 w-4" aria-hidden="true" />
              <input type="file" className="sr-only" aria-label={t("groupWelcome.addImage")} accept="image/jpeg,image/png,image/webp" disabled={reading}
                onChange={event => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (file) attachImage(draft.id, file);
                }} />
            </label>
            {draft.imageDataUrl && <button type="button" className={versionActionClass} disabled={reading}
              title={t("groupWelcome.removeImage")} aria-label={t("groupWelcome.removeImage")}
              onClick={() => setDrafts(current => current.map(item => item.id === draft.id ? { ...item, imageDataUrl: undefined } : item))}
            ><ImageOff className="h-4 w-4" aria-hidden="true" /></button>}
            {drafts.length > 1 && <button type="button" className={`${versionActionClass} hover:text-rose-500`} disabled={reading}
              title={t("groupWelcome.removeVersion")} aria-label={t("groupWelcome.removeVersion")}
              onClick={() => {
                selectVersion((drafts[index + 1] || drafts[index - 1]).id, true);
                setDrafts(current => current.filter(item => item.id !== draft.id));
              }}
            ><Trash2 className="h-4 w-4" aria-hidden="true" /></button>}
          </div>
        </div>
        <textarea id={fieldId + "-" + draft.id} className="ui-control min-h-20 w-full px-2 py-1.5"
          value={draft.text} maxLength={4000} onChange={event => {
            const text = event.target.value;
            setDrafts(current => current.map(item => item.id === draft.id ? { ...item, text } : item));
          }} />
        {draft.imageDataUrl && <img src={draft.imageDataUrl} alt={t("groupWelcome.imagePreview")} className="max-h-32 max-w-full rounded object-contain" />}
        </>}
      </div>)}
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
