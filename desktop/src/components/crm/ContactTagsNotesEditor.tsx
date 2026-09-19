import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, X } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { cn } from "@/lib/utils";
import {
  Button,
  Input,
  SectionLabel,
  Textarea,
} from "@/components/ui/primitives";
import type { Contact } from "@/types/crm";
import { useI18n } from "@/i18n";

/** 产品预设（可给当前客户选用；重命名只影响该客户身上的那份） */
export const TAG_PRESETS = [
  "VIP",
  "高意向",
  "老客户",
  "等待回复",
  "不联系",
] as const;

type Props = {
  contact: Contact;
  /** 更紧凑（会话右侧） */
  compact?: boolean;
  /** 只渲染标签 / 只渲染备注 / 全部（默认） */
  mode?: "all" | "tags" | "notes";
  className?: string;
};

/**
 * 标签：点击开关、双击/✎ 改名、自定义添加、× 移除；
 * 备注：失焦保存。
 * 可用 mode 拆成两块卡片。
 */
export function ContactTagsNotesEditor({
  contact,
  compact,
  mode = "all",
  className,
}: Props) {
  const { t: tr } = useI18n();
  const updateContact = useAppStore((s) => s.updateContact);
  const contacts = useAppStore((s) => s.contacts);
  const pushToast = useAppStore((s) => s.pushToast);

  const [notesDraft, setNotesDraft] = useState(contact.notes ?? "");
  const [customTag, setCustomTag] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  /** 正在编辑文案的标签（原名） */
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  useEffect(() => {
    setNotesDraft(contact.notes ?? "");
    setCustomTag("");
    setShowCustom(false);
    setEditingTag(null);
    setEditDraft("");
  }, [contact.id]);

  useEffect(() => {
    setNotesDraft((d) =>
      d === (contact.notes ?? "") ? d : contact.notes ?? ""
    );
  }, [contact.notes]);

  const allKnownTags = useMemo(() => {
    const set = new Set<string>([...TAG_PRESETS]);
    for (const c of contacts) {
      for (const t of c.tags || []) {
        const x = t.trim();
        if (x) set.add(x);
      }
    }
    for (const t of contact.tags || []) {
      const x = t.trim();
      if (x) set.add(x);
    }
    return Array.from(set);
  }, [contacts, contact.tags]);

  const displayTags = useMemo(() => {
    const presets = TAG_PRESETS.filter((t) => allKnownTags.includes(t));
    const rest = allKnownTags
      .filter((t) => !(TAG_PRESETS as readonly string[]).includes(t))
      .sort((a, b) => a.localeCompare(b, "zh"));
    // 当前客户已有、但不在 allKnown 边角情况
    const onContact = (contact.tags || []).filter((t) => !allKnownTags.includes(t));
    return [...presets, ...rest, ...onContact];
  }, [allKnownTags, contact.tags]);

  const normalizeTag = (raw: string) => raw.trim().replace(/\s+/g, " ");

  const toggleTag = (t: string) => {
    if (editingTag) return;
    const on = contact.tags.includes(t);
    const tags = on
      ? contact.tags.filter((x) => x !== t)
      : [...contact.tags, t];
    updateContact(contact.id, { tags });
  };

  const removeTag = (t: string) => {
    if (!contact.tags.includes(t)) return;
    updateContact(contact.id, {
      tags: contact.tags.filter((x) => x !== t),
    });
    if (editingTag === t) {
      setEditingTag(null);
      setEditDraft("");
    }
  };

  const startEdit = (t: string) => {
    setEditingTag(t);
    setEditDraft(t);
    setShowCustom(false);
  };

  const cancelEdit = () => {
    setEditingTag(null);
    setEditDraft("");
  };

  /** 改当前客户身上的标签文案（old → next） */
  const commitRename = () => {
    if (!editingTag) return;
    const next = normalizeTag(editDraft);
    const old = editingTag;
    if (!next) {
      pushToast(tr("tags.emptyError"), "error");
      return;
    }
    if (next.length > 24) {
      pushToast(tr("tags.tooLong"), "error");
      return;
    }
    if (next === old) {
      cancelEdit();
      return;
    }
    // 与其它已选标签重名
    if (
      contact.tags.some(
        (x) => x !== old && x.toLowerCase() === next.toLowerCase()
      )
    ) {
      pushToast(tr("tags.duplicate"), "error");
      return;
    }
    const tags = contact.tags.map((x) => (x === old ? next : x));
    // 若原来没选中该预设、只是在改展示名：改为「换上新名」
    if (!contact.tags.includes(old)) {
      updateContact(contact.id, {
        tags: [...contact.tags.filter((x) => x !== next), next],
      });
    } else {
      updateContact(contact.id, { tags });
    }
    pushToast(tr("tags.renamed", { tag: next }), "success");
    cancelEdit();
  };

  const addCustom = () => {
    const t = normalizeTag(customTag);
    if (!t) return;
    if (t.length > 24) {
      pushToast(tr("tags.tooLong"), "error");
      return;
    }
    if (contact.tags.some((x) => x.toLowerCase() === t.toLowerCase())) {
      pushToast(tr("tags.duplicate"), "info");
      setCustomTag("");
      return;
    }
    const existing = displayTags.find(
      (x) => x.toLowerCase() === t.toLowerCase()
    );
    updateContact(contact.id, {
      tags: [...contact.tags, existing || t],
    });
    setCustomTag("");
    setShowCustom(false);
    pushToast(tr("tags.added", { tag: existing || t }), "success");
  };

  const saveNotes = () => {
    const next = notesDraft.trimEnd();
    const prev = contact.notes ?? "";
    if (next === prev) return;
    updateContact(contact.id, { notes: next });
  };

  const showTags = mode === "all" || mode === "tags";
  const showNotes = mode === "all" || mode === "notes";

  return (
    <div className={cn(mode === "all" ? "space-y-3" : "space-y-0", className)}>
      {showTags && (
      <div>
        {mode === "all" && (
          <SectionLabel
            action={
              <button
                type="button"
                className="text-2xs text-brand hover:underline"
                onClick={() => {
                  setShowCustom((v) => !v);
                  cancelEdit();
                }}
              >
                {showCustom ? tr("tags.collapse") : tr("tags.custom")}
              </button>
            }
          >
            {tr("tags.title")}
          </SectionLabel>
        )}
        {mode === "all" && (
          <p className="mb-1.5 text-2xs leading-relaxed text-zinc-600">
            {tr("tags.helpAll")}
          </p>
        )}
        {mode === "tags" && (
          <p className="mb-1.5 text-2xs leading-relaxed text-zinc-600">
            {tr("tags.helpCompact")}
          </p>
        )}
        <div className="flex flex-wrap gap-1">
          {displayTags.map((t) => {
            const on = contact.tags.includes(t);
            const isEditing = editingTag === t;

            if (isEditing) {
              return (
                <span
                  key={`edit-${t}`}
                  className="inline-flex max-w-full items-center gap-0.5 rounded-full border border-brand/40 bg-zinc-900 py-0.5 pl-1.5 pr-0.5"
                >
                  <input
                    autoFocus
                    value={editDraft}
                    maxLength={24}
                    onChange={(e) => setEditDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitRename();
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        cancelEdit();
                      }
                    }}
                    onBlur={() => {
                      // 稍延迟，避免点「保存」时先 blur 丢掉
                      window.setTimeout(() => {
                        if (editingTag === t) commitRename();
                      }, 120);
                    }}
                    className="w-20 min-w-[4.5rem] max-w-[9rem] bg-transparent text-2xs text-zinc-100 outline-none"
                  />
                  <button
                    type="button"
                    className="rounded-full px-1.5 py-0.5 text-2xs text-brand hover:bg-brand/10"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={commitRename}
                  >
                    {tr("tags.ok")}
                  </button>
                  <button
                    type="button"
                    className="rounded-full p-0.5 text-zinc-500 hover:text-zinc-300"
                    title={tr("tags.cancel")}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={cancelEdit}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            }

            return (
              <span
                key={t}
                className={cn(
                  "group inline-flex items-center overflow-hidden rounded-full",
                  on ? "bg-brand/15" : "bg-zinc-900"
                )}
              >
                <button
                  type="button"
                  onClick={() => toggleTag(t)}
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    startEdit(t);
                  }}
                  title={
                    on
                      ? tr("tags.toggleOn")
                      : tr("tags.toggleOff")
                  }
                  className={cn(
                    "px-2 py-0.5 text-2xs transition-colors",
                    on
                      ? "text-brand"
                      : "text-zinc-500 hover:text-zinc-300"
                  )}
                >
                  {t}
                </button>
                <button
                  type="button"
                  className={cn(
                    "py-0.5 pr-0.5 text-zinc-500 opacity-70 hover:text-zinc-200",
                    "opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                  )}
                  title={tr("tags.rename")}
                  onClick={(e) => {
                    e.stopPropagation();
                    startEdit(t);
                  }}
                >
                  <Pencil className="h-2.5 w-2.5" />
                </button>
                {on && (
                  <button
                    type="button"
                    className={cn(
                      "py-0.5 pr-1",
                      on ? "text-brand/80 hover:text-brand" : "text-zinc-500"
                    )}
                    title={tr("tags.remove")}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeTag(t);
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            );
          })}
          {displayTags.length === 0 && (
            <span className="text-2xs text-zinc-600">{tr("tags.empty")}</span>
          )}
        </div>
        {(showCustom || mode === "tags") && (
          <div className="mt-1.5 flex items-center gap-1">
            <Input
              value={customTag}
              onChange={(e) => setCustomTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustom();
                }
              }}
              placeholder={tr("tags.newPlaceholder")}
              className="!h-7 flex-1 !text-2xs"
              maxLength={24}
            />
            <Button
              variant="secondary"
              className="!min-h-7 !px-2 text-2xs"
              onClick={addCustom}
            >
              <Plus className="h-3 w-3" />
              {tr("tags.add")}
            </Button>
          </div>
        )}
      </div>
      )}

      {showNotes && (
      <label className="block text-2xs text-zinc-500">
        {mode === "all" ? tr("notes.title") : null}
        <Textarea
          value={notesDraft}
          onChange={(e) => setNotesDraft(e.target.value)}
          onBlur={saveNotes}
          rows={compact ? (mode === "notes" ? 5 : 3) : 4}
          placeholder={tr("notes.placeholder")}
          className={cn("mt-0", mode === "all" && "mt-1")}
        />
        <span className="mt-0.5 block text-2xs text-zinc-600">
          {tr("notes.autoSave")}
          {notesDraft !== (contact.notes ?? "") ? ` · ${tr("notes.unsaved")}` : ""}
        </span>
      </label>
      )}
    </div>
  );
}
