import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "@/store/appStore";
import { Button, Input, SectionLabel, Textarea } from "@/components/ui/primitives";
import { baileysRemoveQuickReply, baileysSyncQuickReplies } from "@/lib/baileys";
import { isWaAccountConnected } from "@/lib/accountConnection";
import { getQuickReplyCategories, QUICK_REPLY_CATEGORIES } from "@/lib/quickReplies";
import type { AppSettings } from "@/store/appStore";
import { useI18n, type TranslationKey } from "@/i18n";

type QuickReply = AppSettings["quickReplies"][number];
const MAX_QUICK_REPLY_MEDIA_BYTES = 8 * 1024 * 1024;

const TEMPLATE_KEYS: { title: TranslationKey; body: TranslationKey; category: QuickReply["category"] }[] = [
  {
    title: "settingsQuickReplies.template.greeting.title",
    body: "settingsQuickReplies.template.greeting.body",
    category: "opening",
  },
  {
    title: "settingsQuickReplies.template.requirements.title",
    body: "settingsQuickReplies.template.requirements.body",
    category: "quote",
  },
  {
    title: "settingsQuickReplies.template.followUp.title",
    body: "settingsQuickReplies.template.followUp.body",
    category: "follow-up",
  },
];

export function SettingsQuickRepliesPanel() {
  const { t } = useI18n();
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const connection = useAppStore((state) => state.baileysUi.connection);
  const pushToast = useAppStore((state) => state.pushToast);
  const [busy, setBusy] = useState(false);
  const [saveHint, setSaveHint] = useState<"idle" | "saving" | "saved">("idle");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [listQuery, setListQuery] = useState("");
  const [listCategory, setListCategory] = useState("all");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replies = settings.quickReplies || [];
  const customCategories = settings.quickReplyCustomCategories || [];
  const categoryOptions = getQuickReplyCategories(customCategories);
  const visibleReplies = useMemo(() => {
    const query = listQuery.trim().toLocaleLowerCase();
    return replies
      .map((reply, index) => ({ reply, index }))
      .filter(({ reply }) => {
        const matchesCategory = listCategory === "all" || reply.category === listCategory;
        const haystack = `${reply.title}\n${reply.body}\n${reply.media?.fileName || ""}`.toLocaleLowerCase();
        return matchesCategory && (!query || haystack.includes(query));
      });
  }, [listCategory, listQuery, replies]);
  const accountId =
    settings.liveBaileysAccountId || settings.activeAccountId || null;
  const connected = isWaAccountConnected(
    settings.waAccounts,
    accountId,
    settings.liveBaileysAccountId,
    connection
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (hintTimer.current) clearTimeout(hintTimer.current);
    };
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-zinc-100">{t("settingsQuickReplies.title")}</h3>
            <SaveBadge state={saveHint} />
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
            {t("settingsQuickReplies.description")}
          </p>
          <p className="mt-1 text-2xs text-zinc-600">
            {t("settingsQuickReplies.mediaOnlyLocal")}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-1.5 sm:items-end">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="sm" className="text-2xs"
              disabled={replies.length >= 40}
              onClick={() => addReply()}
            >
              {t("settingsQuickReplies.add")}
            </Button>
            <Button
              variant="secondary"
              size="sm" className="text-2xs"
              onClick={() => setCategoriesOpen((open) => !open)}
            >
              {t("settingsQuickReplies.manageCategories")}
            </Button>
            <Button
              variant="secondary"
              size="sm" className="text-2xs"
              disabled={busy || !connected || replies.length === 0}
              title={
                !connected
                  ? t("settingsQuickReplies.connectFirst")
                  : replies.length === 0
                    ? t("settingsQuickReplies.nothingToSync")
                    : t("settingsQuickReplies.syncHint")
              }
              onClick={() => void syncReplies()}
            >
              {busy ? t("settingsQuickReplies.syncing") : t("settingsQuickReplies.sync")}
            </Button>
          </div>
          {!connected && (
            <p className="max-w-[220px] text-right text-2xs leading-snug text-zinc-600">
              {t("settingsQuickReplies.connectFirst")}
            </p>
          )}
        </div>
      </header>

      {categoriesOpen && (
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <SectionLabel>{t("settingsQuickReplies.categoryList")}</SectionLabel>
            <span className="text-2xs text-zinc-600">{customCategories.length} / 20</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Input
              value={newCategory}
              maxLength={32}
              placeholder={t("settingsQuickReplies.categoryPlaceholder")}
              aria-label={t("settingsQuickReplies.categoryPlaceholder")}
              onChange={(event) => setNewCategory(event.target.value)}
            />
            <Button
              variant="primary"
              size="sm"
              disabled={!newCategory.trim() || customCategories.length >= 20}
              onClick={() => {
                const label = newCategory.trim();
                if (!label) return;
                const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
                updateSettings({
                  quickReplyCustomCategories: [...customCategories, { id, label }],
                });
                setNewCategory("");
                markSavedSoon();
              }}
            >
              {t("settingsQuickReplies.addCategory")}
            </Button>
          </div>
          {customCategories.length > 0 && (
            <div className="mt-3 space-y-2">
              {customCategories.map((category) => (
                <div key={category.id} className="flex items-center gap-2">
                  <Input
                    value={category.label}
                    maxLength={32}
                    aria-label={category.label}
                    onChange={(event) => {
                      const label = event.target.value;
                      updateSettings({
                        quickReplyCustomCategories: customCategories.map((item) =>
                          item.id === category.id ? { ...item, label } : item
                        ),
                      });
                      markSavedSoon();
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-2xs text-zinc-500"
                    onClick={() => {
                      const used = replies.some((reply) => reply.category === category.id);
                      if (used) {
                        pushToast(t("settingsQuickReplies.categoryInUse"), "info");
                        return;
                      }
                      updateSettings({
                        quickReplyCustomCategories: customCategories.filter((item) => item.id !== category.id),
                      });
                      markSavedSoon();
                    }}
                  >
                    {t("common.delete")}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
        <div className="mb-3 flex items-center justify-between">
          <SectionLabel>{t("settingsQuickReplies.list")}</SectionLabel>
          <span className="text-2xs text-zinc-600">
            {replies.length} / 40
          </span>
        </div>
        {replies.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            <Input
              value={listQuery}
              onChange={(event) => setListQuery(event.target.value)}
              placeholder={t("multi.searchQuickReplies")}
              aria-label={t("multi.searchQuickReplies")}
              className="min-w-[220px] flex-1"
            />
            <select
              value={listCategory}
              onChange={(event) => setListCategory(event.target.value)}
              aria-label={t("settingsQuickReplies.category")}
              className="ui-control h-9 min-w-[130px] px-2 text-[12px]"
            >
              <option value="all">{t("starred.all")}</option>
              {categoryOptions.map((category) => (
                <option key={category.id} value={category.id}>
                  {QUICK_REPLY_CATEGORIES.some((item) => item.id === category.id)
                    ? t(`quickReply.category.${category.id}` as TranslationKey)
                    : category.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {replies.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-zinc-800 px-6 py-10 text-center">
            <div>
              <p className="text-[12px] text-zinc-400">{t("settingsQuickReplies.empty")}</p>
              <p className="mt-1 text-[11px] text-zinc-600">
                {t("settingsQuickReplies.emptyHint")}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                variant="secondary"
                size="sm" className="text-2xs"
                onClick={() => applyTemplates()}
              >
                {t("settingsQuickReplies.applyTemplates")}
              </Button>
              <Button
                variant="ghost"
                size="sm" className="text-2xs"
                onClick={() => addReply()}
              >
                {t("settingsQuickReplies.startBlank")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {visibleReplies.map(({ reply, index }) => (
              <div
                key={reply.id}
                className="grid gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 md:grid-cols-[110px_minmax(140px,0.35fr)_minmax(0,1fr)_auto] md:items-start"
              >
                <select
                  value={reply.category}
                  aria-label={t("settingsQuickReplies.category")}
                  className="ui-control h-9 w-full px-2 text-[12px]"
                  onChange={(event) =>
                    updateReply(index, {
                      ...reply,
                      category: event.target.value as QuickReply["category"],
                    })
                  }
                >
                  {categoryOptions.map((category) => (
                    <option key={category.id} value={category.id}>
                      {QUICK_REPLY_CATEGORIES.some((item) => item.id === category.id)
                        ? t(`quickReply.category.${category.id}` as TranslationKey)
                        : category.label}
                    </option>
                  ))}
                </select>
                <Input
                  value={reply.title}
                  aria-label={t("settingsQuickReplies.commandTitle")}
                  placeholder={t("settingsQuickReplies.commandPlaceholder")}
                  onChange={(event) =>
                    updateReply(index, {
                      ...reply,
                      title: event.target.value,
                    })
                  }
                />
                <div className="min-w-0 space-y-2">
                  <Textarea
                    value={reply.body}
                    rows={2}
                    aria-label={t("settingsQuickReplies.content")}
                    placeholder={t("settingsQuickReplies.contentPlaceholder")}
                    className="min-h-[64px] resize-y text-[12px]"
                    onChange={(event) =>
                      updateReply(index, { ...reply, body: event.target.value })
                    }
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    {reply.media && (
                      <div className="flex min-w-0 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950/70 px-2 py-1.5">
                        {reply.media.kind === "image" ? (
                          <img src={reply.media.dataUrl} alt="" className="h-8 w-8 rounded object-cover" />
                        ) : reply.media.kind === "audio" ? (
                          <audio src={reply.media.dataUrl} controls className="h-7 max-w-[180px]" />
                        ) : reply.media.kind === "video" ? (
                          <video src={reply.media.dataUrl} controls className="h-10 w-16 rounded object-cover" />
                        ) : null}
                        <span className="max-w-[150px] truncate text-2xs text-zinc-400">{reply.media.fileName}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-2xs text-zinc-500"
                          onClick={() => updateReply(index, { ...reply, media: undefined })}
                        >
                          {t("settingsQuickReplies.removeMedia")}
                        </Button>
                      </div>
                    )}
                    <label className="inline-flex cursor-pointer items-center rounded-md border border-zinc-800 px-2.5 py-1.5 text-2xs text-zinc-400 hover:border-brand/50 hover:text-brand">
                      <input
                        type="file"
                        className="sr-only"
                        accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.currentTarget.value = "";
                          if (file) void attachMedia(index, reply, file);
                        }}
                      />
                      {reply.media
                        ? t("settingsQuickReplies.replaceMedia")
                        : t("settingsQuickReplies.addMedia")}
                    </label>
                    <span className="text-2xs text-zinc-600">{t("settingsQuickReplies.mediaHint")}</span>
                  </div>
                </div>
                <div className="flex min-h-9 items-center justify-end">
                  {confirmDeleteId === reply.id ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm" className="text-2xs text-rose-400"
                        onClick={() => void removeReply(reply.id)}
                      >
                        {t("settingsQuickReplies.confirmDelete")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm" className="text-2xs text-zinc-500"
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        {t("common.cancel")}
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-2xs text-zinc-500"
                        disabled={replies.length >= 40}
                        onClick={() =>
                          addReply({
                            title: reply.title,
                            body: reply.body,
                            category: reply.category,
                            media: reply.media,
                          })
                        }
                      >
                        {t("settingsQuickReplies.duplicate")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm" className="text-2xs text-zinc-500"
                        onClick={() => setConfirmDeleteId(reply.id)}
                      >
                        {t("common.delete")}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {visibleReplies.length === 0 && (
              <div className="rounded-lg border border-dashed border-zinc-800 px-6 py-8 text-center text-[11px] text-zinc-600">
                {t("crmPanel.noMatchingReplies")}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );

  function markSavedSoon() {
    setSaveHint("saving");
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => {
      setSaveHint("saved");
      hintTimer.current = setTimeout(() => setSaveHint("idle"), 1600);
    }, 280);
  }

  function commitReplies(next: QuickReply[]) {
    updateSettings({ quickReplies: next });
    markSavedSoon();
  }

  function updateReply(index: number, reply: QuickReply) {
    // 始终基于 store 最新列表，避免连改多条时闭包过期
    const current = useAppStore.getState().settings.quickReplies || [];
    const next = [...current];
    const at = next.findIndex((item) => item.id === reply.id);
    if (at >= 0) next[at] = reply;
    else next[index] = reply;
    updateSettings({ quickReplies: next });
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveHint("saving");
    saveTimer.current = setTimeout(() => markSavedSoon(), 320);
  }

  async function attachMedia(index: number, reply: QuickReply, file: File) {
    if (file.size > MAX_QUICK_REPLY_MEDIA_BYTES) {
      pushToast(t("settingsQuickReplies.mediaTooLarge"), "info");
      return;
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("read failed"));
        reader.readAsDataURL(file);
      });
      const kind = file.type.startsWith("image/")
        ? "image"
        : file.type.startsWith("audio/")
          ? "audio"
          : file.type.startsWith("video/")
            ? "video"
            : "file";
      updateReply(index, {
        ...reply,
        media: {
          dataUrl,
          fileName: file.name.slice(0, 180),
          mimeType: file.type || "application/octet-stream",
          kind,
          size: file.size,
        },
      });
      pushToast(t("settingsQuickReplies.mediaAdded"), "success");
    } catch {
      pushToast(t("settingsQuickReplies.mediaReadFailed"), "error");
    }
  }

  function addReply(seed?: Omit<QuickReply, "id">) {
    if (replies.length >= 40) {
      pushToast(t("settingsQuickReplies.limit"), "info");
      return;
    }
    const item: QuickReply = {
      id: `qr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      title: seed?.title ?? "",
      body: seed?.body ?? "",
      category: seed?.category ?? "other",
    };
    commitReplies([...replies, item].slice(0, 40));
  }

  function applyTemplates() {
    const room = 40 - replies.length;
    if (room <= 0) {
      pushToast(t("settingsQuickReplies.limit"), "info");
      return;
    }
    const stamped = TEMPLATE_KEYS.slice(0, room).map((item, i) => ({
      id: `qr-${Date.now().toString(36)}-${i}`,
      title: t(item.title),
      body: t(item.body),
      category: item.category,
    }));
    commitReplies([...replies, ...stamped]);
    pushToast(t("settingsQuickReplies.templatesAdded", { count: stamped.length }), "success");
  }

  async function removeReply(id: string) {
    setConfirmDeleteId(null);
    if (connected) {
      try {
        await baileysRemoveQuickReply(id, accountId);
      } catch (error) {
        pushToast(
          error instanceof Error ? error.message : t("settingsQuickReplies.deleteFailed"),
          "error"
        );
        return;
      }
    }
    const removed = replies.find((r) => r.id === id);
    const next = replies.filter((reply) => reply.id !== id);
    commitReplies(next);
    if (removed) {
      pushToast(t("settingsQuickReplies.deleted"), "info");
    }
  }

  async function syncReplies() {
    if (!connected) {
      pushToast(t("settingsQuickReplies.connectFirst"), "error");
      return;
    }
    setBusy(true);
    try {
      // WhatsApp 快捷指令只接受文字；媒体话术仍保留在本机，在聊天输入条中使用。
      const result = await baileysSyncQuickReplies(
        replies
          .filter((reply) => reply.body.trim())
          .map(({ media: _media, ...reply }) => reply),
        accountId
      );
      pushToast(t("settingsQuickReplies.synced", { count: result.synced }), "success");
    } catch (error) {
      pushToast(
        error instanceof Error ? error.message : t("settingsQuickReplies.syncFailed"),
        "error"
      );
    } finally {
      setBusy(false);
    }
  }
}

function SaveBadge({ state }: { state: "idle" | "saving" | "saved" }) {
  const { t } = useI18n();
  if (state === "idle") return null;
  return (
    <span
      className={
        state === "saving"
          ? "rounded-full bg-zinc-800 px-2 py-0.5 text-2xs text-zinc-500"
          : "rounded-full bg-emerald-500/10 px-2 py-0.5 text-2xs text-emerald-400/90"
      }
    >
      {state === "saving" ? t("common.saving") : t("settingsQuickReplies.autoSaved")}
    </span>
  );
}
