/**
 * 聊天顶栏折叠的客户备注（与 CRM 共用 contact.notes）。
 * 失焦自动保存，无独立保存按钮。
 */
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, StickyNote } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import {
  getInternalNote,
  setInternalNote,
} from "@/lib/internalNotes";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

export function ChatInternalNoteBar({
  chatId,
  contactId,
  openRequest,
}: {
  chatId?: string | null;
  contactId?: string | null;
  openRequest?: number;
}) {
  const { t } = useI18n();
  const contacts = useAppStore((s) => s.contacts);
  const updateContact = useAppStore((s) => s.updateContact);
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);

  const contact = contacts.find((c) => c.id === contactId);
  const legacy = getInternalNote(
    settings.internalNotesByKey,
    chatId,
    contactId
  ).trim();
  const saved = (contact?.notes ?? "").trim() || legacy;

  const [open, setOpen] = useState(false);
  const [text, setText] = useState(saved);
  const [dirty, setDirty] = useState(false);
  const textRef = useRef(text);
  const dirtyRef = useRef(dirty);
  textRef.current = text;
  dirtyRef.current = dirty;

  useEffect(() => {
    const c = useAppStore
      .getState()
      .contacts.find((x) => x.id === contactId);
    const leg = getInternalNote(
      useAppStore.getState().settings.internalNotesByKey,
      chatId,
      contactId
    ).trim();
    setText((c?.notes ?? "").trim() || leg);
    setDirty(false);
    setOpen(false);
  }, [chatId, contactId, contact?.notes]);

  useEffect(() => {
    if (openRequest) setOpen(true);
  }, [openRequest]);

  if (!contactId || !contact) return null;

  const persist = (nextRaw: string) => {
    const next = nextRaw.trimEnd();
    const prev = (contact.notes ?? "").trimEnd();
    if (next === prev) {
      setDirty(false);
      return;
    }
    updateContact(contact.id, { notes: next });
    if (settings.internalNotesByKey) {
      let map = settings.internalNotesByKey;
      map = setInternalNote(map, "", chatId, contactId);
      map = setInternalNote(map, "", null, contactId);
      updateSettings({ internalNotesByKey: map });
    }
    setDirty(false);
  };

  const onBlurSave = () => {
    if (!dirtyRef.current) return;
    persist(textRef.current);
  };

  return (
    <div className="chat-internal-note-bar border-b border-zinc-800/80 bg-zinc-900/40 transition-colors">
      <button
        type="button"
        onClick={() => {
          // 收起前若有未保存修改，先落盘
          if (open && dirtyRef.current) persist(textRef.current);
          setOpen((v) => !v);
        }}
        className="flex w-full items-center gap-1.5 px-4 py-1 text-left transition-colors hover:bg-zinc-800/50"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        )}
        <StickyNote className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        <span className="text-[11px] font-medium text-zinc-300">{t("notes.title")}</span>
        <span className="text-2xs text-zinc-600">{t("notes.localOnly")}</span>
        {!open && saved && (
          <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-500">
            · {saved}
          </span>
        )}
        {!open && !saved && (
          <span className="text-[11px] text-zinc-600">· {t("notes.addHint")}</span>
        )}
        {open && dirty && (
          <span className="ml-auto text-2xs text-zinc-600">{t("notes.autoSave")}</span>
        )}
      </button>
      {open && (
        <div className="px-4 pb-2">
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setDirty(true);
            }}
            onBlur={onBlurSave}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "s") {
                e.preventDefault();
                persist(textRef.current);
              }
            }}
            rows={2}
            placeholder={t("notes.placeholderWithAutoSave")}
            className={cn(
              "ui-control w-full resize-y px-2.5 py-1.5 text-[12px] leading-5"
            )}
            autoFocus
          />
        </div>
      )}
    </div>
  );
}
