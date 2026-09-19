import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/store/appStore";
import { Button, Input, SectionLabel, Textarea } from "@/components/ui/primitives";
import { baileysRemoveQuickReply, baileysSyncQuickReplies } from "@/lib/baileys";
import { isWaAccountConnected } from "@/lib/accountConnection";
import { QUICK_REPLY_CATEGORIES } from "@/lib/quickReplies";
import type { AppSettings } from "@/store/appStore";
import { useI18n, type TranslationKey } from "@/i18n";

type QuickReply = AppSettings["quickReplies"][number];

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
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replies = settings.quickReplies || [];
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

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
        <div className="mb-3 flex items-center justify-between">
          <SectionLabel>{t("settingsQuickReplies.list")}</SectionLabel>
          <span className="text-2xs text-zinc-600">
            {replies.length} / 40
          </span>
        </div>

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
            {replies.map((reply, index) => (
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
                  {QUICK_REPLY_CATEGORIES.map((category) => (
                    <option key={category.id} value={category.id}>
                      {t(`quickReply.category.${category.id}` as TranslationKey)}
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
                    <Button
                      variant="ghost"
                      size="sm" className="text-2xs text-zinc-500"
                      onClick={() => setConfirmDeleteId(reply.id)}
                    >
                      {t("common.delete")}
                    </Button>
                  )}
                </div>
              </div>
            ))}
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
      const result = await baileysSyncQuickReplies(replies, accountId);
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
