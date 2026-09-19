/**
 * 客户备注（唯一入口）：写在 contact.notes 上，客户不可见、不发 WhatsApp。
 * 兼容读取旧版 settings.internalNotesByKey，首次保存时并入 contact.notes。
 * 失焦 / Ctrl+S 自动保存，无独立保存按钮。
 */
import { useEffect, useRef, useState } from "react";
import { StickyNote } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import {
  getInternalNote,
  setInternalNote,
} from "@/lib/internalNotes";
import { SectionLabel } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { Contact } from "@/types/crm";
import { useI18n } from "@/i18n";

function legacyNoteFor(
  map: Record<string, string> | undefined,
  contactId?: string | null,
  chatId?: string | null
): string {
  return getInternalNote(map, chatId, contactId).trim();
}

export function CustomerNoteEditor({
  contact,
  chatId,
  compact,
  className,
}: {
  contact: Contact;
  chatId?: string | null;
  compact?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const updateContact = useAppStore((s) => s.updateContact);
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);

  const legacy = legacyNoteFor(
    settings.internalNotesByKey,
    contact.id,
    chatId
  );
  const archived = (contact.notes ?? "").trim();
  const initial = archived || legacy;

  const [text, setText] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const notePreview = text.trim()
    ? t("notes.charCount", { count: text.trim().length })
    : t("notes.empty");
  const textRef = useRef(text);
  const dirtyRef = useRef(dirty);
  const contactIdRef = useRef(contact.id);
  const chatIdRef = useRef(chatId);
  textRef.current = text;
  dirtyRef.current = dirty;
  contactIdRef.current = contact.id;
  chatIdRef.current = chatId;

  useEffect(() => {
    const leg = legacyNoteFor(
      settings.internalNotesByKey,
      contact.id,
      chatId
    );
    const base = (contact.notes ?? "").trim() || leg;
    setText(base);
    setDirty(false);
    setJustSaved(false);
  }, [contact.id, contact.notes, chatId, settings.internalNotesByKey]);

  const persist = (nextRaw: string, opts?: { silent?: boolean }) => {
    const next = nextRaw.trimEnd();
    const id = contactIdRef.current;
    const cId = chatIdRef.current;
    const prev = (
      useAppStore.getState().contacts.find((c) => c.id === id)?.notes ?? ""
    ).trimEnd();
    if (next === prev && !dirtyRef.current) {
      setDirty(false);
      return;
    }
    if (next === prev) {
      setDirty(false);
      return;
    }
    updateContact(id, { notes: next });
    const st = useAppStore.getState().settings;
    if (st.internalNotesByKey) {
      let map = st.internalNotesByKey;
      map = setInternalNote(map, "", cId, id);
      map = setInternalNote(map, "", null, id);
      updateSettings({ internalNotesByKey: map });
    }
    setDirty(false);
    if (!opts?.silent) {
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 1200);
    }
  };

  const onBlurSave = () => {
    if (!dirtyRef.current) return;
    persist(textRef.current, { silent: true });
  };

  return (
    <section
      className={cn(
        "rounded-xl border border-zinc-800 bg-zinc-900/30",
        compact ? "p-2.5" : "p-3",
        className
      )}
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <StickyNote className="h-3.5 w-3.5 text-zinc-400" />
        <SectionLabel className="!mb-0">{t("notes.title")}</SectionLabel>
        <span className="text-2xs text-zinc-600">{t("notes.localOnly")}</span>
        <span className="ml-auto text-2xs text-zinc-600">
          {dirty
            ? t("notes.editing")
              : justSaved
              ? t("notes.saved")
              : notePreview}
        </span>
      </div>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setDirty(true);
          setJustSaved(false);
        }}
        onBlur={onBlurSave}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "s") {
            e.preventDefault();
            persist(textRef.current);
          }
        }}
        rows={compact ? 4 : 5}
        placeholder={`${t("notes.placeholder")} (${t("notes.autoSave")})`}
        className="ui-control w-full resize-y px-2.5 py-2 text-[12px] leading-5"
      />
    </section>
  );
}
