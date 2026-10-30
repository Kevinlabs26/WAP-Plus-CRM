import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/store/appStore";
import { useI18n } from "@/i18n";
import { langShortLabel, resolveTargetLanguage, translateDraftText, TRANSLATE_LANGS } from "@/lib/translateDraft";
import type { Contact } from "@/types/crm";

export function useMultiWindowDraftTranslation(opts: {
  chatId: string; contact?: Contact; lastInboundBody?: string; draft: string;
  getDraft: () => string; setDraft: (text: string) => void;
}) {
  const { t } = useI18n();
  const settings = useAppStore(state => state.settings);
  const updateContact = useAppStore(state => state.updateContact);
  const pushToast = useAppStore(state => state.pushToast);
  const [target, setTarget] = useState(() => resolveTargetLanguage(opts.contact, settings, opts.lastInboundBody));
  const [translating, setTranslating] = useState(false);
  const [original, setOriginal] = useState<string | null>(null);
  const translated = useRef<string | null>(null);
  const request = useRef(0);
  useEffect(() => {
    setTarget(resolveTargetLanguage(opts.contact, settings, opts.lastInboundBody));
  }, [opts.contact, settings.translateTargetLang, opts.lastInboundBody]);
  useEffect(() => {
    setOriginal(null); translated.current = null; setTranslating(false);
    return () => { request.current++; };
  }, [opts.chatId]);
  useEffect(() => {
    if (opts.draft !== translated.current) {
      request.current++; setTranslating(false); setOriginal(null);
    }
  }, [opts.draft]);
  const changeDraft = (text: string) => {
    request.current++; setTranslating(false); setOriginal(null);
    opts.setDraft(text);
  };
  const changeLanguage = (language: string) => {
    if (translating || (language !== "auto" && !TRANSLATE_LANGS.some(item => item.code === language))) return;
    const contact = { ...opts.contact, preferredLang: language === "auto" ? undefined : language };
    if (opts.contact) updateContact(opts.contact.id, { preferredLang: contact.preferredLang });
    setTarget(resolveTargetLanguage(contact, useAppStore.getState().settings, opts.lastInboundBody));
  };
  const translate = async () => {
    const source = opts.getDraft().trim();
    if (!source || translating) return;
    const id = ++request.current, base = original ?? source;
    setTranslating(true);
    try {
      const result = await translateDraftText(base, target.code, useAppStore.getState().settings);
      if (id !== request.current) return;
      if (opts.getDraft().trim() !== source) { pushToast(t("runtime.translationDraftChanged"), "info"); return; }
      if (result.fallback || result.error || !result.text?.trim()) { pushToast(result.error || t("runtime.translateFailed"), "error"); return; }
      const next = result.text.trim();
      translated.current = next; setOriginal(base); opts.setDraft(next);
      pushToast(t("translation.done", { language: langShortLabel(result.targetLang) }), "success");
    } catch (error) {
      if (id === request.current) pushToast(error instanceof Error ? error.message : t("runtime.translateFailed"), "error");
    } finally { if (id === request.current) setTranslating(false); }
  };
  return { target, translating, original, changeDraft, changeLanguage, translate,
    restore: () => { if (original !== null && !translating) changeDraft(original); },
  };
}
