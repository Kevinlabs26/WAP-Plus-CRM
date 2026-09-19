import { useMemo } from "react";
import { useAppStore } from "@/store/appStore";
import { SectionLabel } from "@/components/ui/primitives";
import {
  FollowUpWorkRow,
  buildContactWorkCard,
} from "@/components/crm/FollowUpWorkRow";
import { displayContactLabel } from "@/lib/utils";
import type { Contact, FollowUp } from "@/types/crm";
import { useI18n } from "@/i18n";

type Props = {
  viewMode?: "list" | "grid";
  scopedFollowUps?: FollowUp[];
};

export function FollowUpsView({ viewMode = "list", scopedFollowUps }: Props) {
  const { t } = useI18n();
  const allFollowUps = useAppStore((s) => s.followUps);
  const followUps = scopedFollowUps ?? allFollowUps;
  const contacts = useAppStore((s) => s.contacts);
  const chats = useAppStore((s) => s.chats);
  const toggleFollowUp = useAppStore((s) => s.toggleFollowUp);
  const updateContact = useAppStore((s) => s.updateContact);
  const openContactWorkspace = useAppStore((s) => s.openContactWorkspace);
  const pushToast = useAppStore((s) => s.pushToast);
  const salesStageLabels = useAppStore((s) => s.settings.salesStageLabels);

  const today = (() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  })();

  const contactById = useMemo(() => {
    const m = new Map<string, Contact>();
    for (const c of contacts) m.set(c.id, c);
    return m;
  }, [contacts]);

  const lastMsgByContact = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of chats) {
      if (c.contactId && c.lastMessage) m.set(c.contactId, c.lastMessage);
    }
    return m;
  }, [chats]);

  const groups = useMemo(() => {
    const pending = followUps
      .filter((f) => !f.done)
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    return {
      pending,
      overdue: pending.filter((f) => (f.dueAt || "").slice(0, 10) < today),
      dueToday: pending.filter((f) => (f.dueAt || "").slice(0, 10) === today),
      later: pending.filter((f) => (f.dueAt || "").slice(0, 10) > today),
      done: followUps.filter((f) => f.done),
    };
  }, [followUps, today]);
  const { pending, overdue, dueToday, later, done } = groups;

  const openChatForFollowUp = (
    f: FollowUp,
    opts?: { withDraft?: boolean }
  ) => {
    const contact = contactById.get(f.contactId);
    const label = displayContactLabel(
      contact?.name || f.contactName,
      contact?.phone,
      contact?.channelAddress,
      lastMsgByContact.get(f.contactId),
      { isGroup: !!contact?.isGroup }
    );
    const st = useAppStore.getState();
    const chatId = `bridge-chat-${f.contactId}`;
    const bucket = st.messagesByChatId[chatId];
    const latest = bucket?.[bucket.length - 1];
    const draft =
      opts?.withDraft && f.note ? `${t("followUps.draftPrefix")}${f.note}` : undefined;
    openContactWorkspace(f.contactId, {
      focusMessageId: latest?.id,
      prefillDraft: draft,
    });
    pushToast(
      opts?.withDraft
        ? t("followUps.openedWithNote", { label })
        : t("followUps.opened", { label }),
      "info"
    );
  };

  const renderRow = (
    f: FollowUp,
    tone: "overdue" | "today" | "later"
  ) => {
    const contact = contactById.get(f.contactId);
    const card = buildContactWorkCard(
      f,
      contact,
      lastMsgByContact.get(f.contactId),
      salesStageLabels
    );
    return (
      <FollowUpWorkRow
        key={f.id}
        followUp={f}
        card={card}
        tone={tone}
        onToggleDone={() => {
          toggleFollowUp(f.id);
          pushToast(t("followUps.completed", { title: card.title }), "success");
        }}
        onOpen={() => openChatForFollowUp(f)}
        onFollowDraft={() => openChatForFollowUp(f, { withDraft: true })}
        onSaveContact={
          contact
            ? (patch) => {
                updateContact(contact.id, patch);
                pushToast(
                  t("followUps.updated", { title: patch.name?.trim() || card.title }),
                  "success"
                );
              }
            : undefined
        }
      />
    );
  };

  return (
    <div className="w-full">
      <div>
        <div className="mx-auto w-full max-w-5xl space-y-4">
        {pending.length === 0 && (
          <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-12 text-center">
            <div className="text-[15px] font-semibold text-zinc-200">
              {done.length > 0 ? t("followUps.allDone") : t("followUps.empty")}
            </div>
            <p className="mx-auto mt-2 max-w-md text-[12px] leading-5 text-zinc-500">
              {done.length > 0
                ? t("followUps.allDoneHint")
                : t("followUps.emptyHint")}
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => useAppStore.getState().setActiveNav("chats")}
                className="inline-flex items-center rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-[12px] text-zinc-200 hover:border-zinc-500 hover:bg-zinc-800"
              >
                {t("followUps.backToChats")}
              </button>
            </div>
            {done.length > 0 && (
              <p className="mt-3 text-[11px] text-zinc-600">
                {t("followUps.completedCount", { count: done.length })}
              </p>
            )}
          </div>
        )}

        {overdue.length > 0 && (
          <div>
            <SectionLabel>{t("followUps.overdue", { count: overdue.length })}</SectionLabel>
            <div className={viewMode === "grid" ? "grid gap-2 md:grid-cols-2 xl:grid-cols-3" : "space-y-2"}>
              {overdue.map((f) => renderRow(f, "overdue"))}
            </div>
          </div>
        )}
        {dueToday.length > 0 && (
          <div>
            <SectionLabel>{t("followUps.today", { count: dueToday.length })}</SectionLabel>
            <div className={viewMode === "grid" ? "grid gap-2 md:grid-cols-2 xl:grid-cols-3" : "space-y-2"}>
              {dueToday.map((f) => renderRow(f, "today"))}
            </div>
          </div>
        )}
        {later.length > 0 && (
          <div>
            <SectionLabel>{t("followUps.later", { count: later.length })}</SectionLabel>
            <div className={viewMode === "grid" ? "grid gap-2 md:grid-cols-2 xl:grid-cols-3" : "space-y-2"}>
              {later.map((f) => renderRow(f, "later"))}
            </div>
          </div>
        )}
        {done.length > 0 && (
          <div className="pt-4">
            <SectionLabel>{t("followUps.done", { count: done.length })}</SectionLabel>
            <div className={viewMode === "grid" ? "grid gap-2 md:grid-cols-2 xl:grid-cols-3" : "space-y-2"}>
            {done.slice(0, 30).map((f) => {
              const contact = contactById.get(f.contactId);
              const title = displayContactLabel(
                contact?.name || f.contactName,
                contact?.phone,
                contact?.channelAddress,
                lastMsgByContact.get(f.contactId),
                { isGroup: !!contact?.isGroup }
              );
              return (
                <div
                  key={f.id}
                  className="flex items-center gap-2 rounded-lg border border-zinc-800/60 bg-zinc-900/20 px-3 py-2 text-[12px] text-zinc-500"
                >
                  <span className="min-w-0 flex-1 truncate">{title}</span>
                  <span className="shrink-0 tabular-nums text-2xs">
                    {(f.dueAt || "").slice(0, 10)}
                  </span>
                </div>
              );
            })}
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
