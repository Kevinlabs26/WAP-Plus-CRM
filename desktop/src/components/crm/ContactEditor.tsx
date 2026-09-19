import { CalendarPlus, MessageSquare } from "lucide-react";
import { useEffect, useState } from "react";
import type { Contact, SalesStage } from "@/types/crm";
import { cn, displayPhone } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import { Button, Input, Textarea } from "@/components/ui/primitives";
import { ActivityTimeline } from "@/components/crm/ActivityTimeline";
import { ContactTagsNotesEditor } from "@/components/crm/ContactTagsNotesEditor";
import { SPEECH_LANG_OPTIONS } from "@/components/chat/speakMessage";
import { useI18n } from "@/i18n";

type Props = {
  contact: Contact;
  title: string;
  needsName: boolean;
  phones: { id: string; name: string; remark: string }[];
  stages: { id: SalesStage; label: string }[];
  updateContact: (id: string, patch: Partial<Contact>) => void;
  openContactWorkspace: (id: string) => void;
  scheduleFollowUp: (
    contactId: string,
    dueAt: string,
    note?: string
  ) => { dueAt: string } | null;
  scheduleTomorrowFollowUp: (
    contactId: string,
    note?: string
  ) => { dueAt: string } | null;
  pushToast: (
    message: string,
    tone?: "info" | "success" | "error"
  ) => void;
  compact?: boolean;
};

export function ContactEditor({
  contact,
  title,
  needsName,
  phones,
  stages,
  updateContact,
  openContactWorkspace,
  scheduleFollowUp,
  scheduleTomorrowFollowUp,
  pushToast,
  compact,
}: Props) {
  const { t } = useI18n();
  return (
    <div className={cn("space-y-3", !compact && "mx-auto max-w-lg")}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <Avatar
            name={title}
            seed={contact.phone || contact.id}
            src={contact.avatarUrl}
            size="lg"
          />
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold tracking-tight">
              {title}
            </div>
            <div className="text-2xs tabular-nums text-zinc-500">
              {displayPhone(contact.phone) || contact.phone || t("contact.noPhone")}
            </div>
            {needsName ? (
              <div className="mt-1 text-2xs text-amber-300/90">
                {t("contact.nameHint")}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button
            variant="secondary"
            className="!min-h-7 gap-1 !px-2 text-2xs"
            onClick={() => openContactWorkspace(contact.id)}
          >
            <MessageSquare className="h-3 w-3" />
            {t("contact.chat")}
          </Button>
          <Button
            variant="secondary"
            className="!min-h-7 gap-1 !px-2 text-2xs"
            onClick={() => {
              const result = scheduleFollowUp(
                contact.id,
                contact.nextFollowUpAt || new Date().toISOString().slice(0, 10),
                t("contact.followUpNote", { name: title })
              );
              if (result) pushToast(t("contact.scheduled", { name: title }), "success");
            }}
          >
            <CalendarPlus className="h-3 w-3" />
            {t("contact.followUp")}
          </Button>
          <Button
            variant="primary"
            className="!min-h-7 gap-1 !px-2 text-2xs"
            onClick={() => {
              const result = scheduleTomorrowFollowUp(contact.id);
              if (result) pushToast(t("contact.tomorrowSet", { name: title }), "success");
            }}
          >
            <CalendarPlus className="h-3 w-3" />
            {t("contact.tomorrowFollowUp")}
          </Button>
        </div>
      </div>

      <Field
        label={needsName ? t("contact.displayName") : t("contact.name")}
        value={contact.name}
        onChange={(value) => updateContact(contact.id, { name: value })}
      />
      <Field
        label={t("contact.phone")}
        value={contact.phone}
        onChange={(value) => updateContact(contact.id, { phone: value })}
      />
      <Field
        label={t("contact.company")}
        value={contact.company ?? ""}
        onChange={(value) => updateContact(contact.id, { company: value })}
      />
      <Field
        label={t("contact.country")}
        value={contact.country ?? ""}
        onChange={(value) => updateContact(contact.id, { country: value })}
      />
      <label className="block text-2xs text-zinc-500">
        {t("contact.speechLanguage")}
        <select
          value={contact.language ?? ""}
          onChange={(event) =>
            updateContact(contact.id, {
              language: event.target.value || undefined,
            })
          }
          className="ui-control mt-1 w-full px-2.5 text-[13px]"
        >
          <option value="">{t("contact.autoDetect")}</option>
          {SPEECH_LANG_OPTIONS.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <Field
        label={t("contact.source")}
        value={contact.source ?? ""}
        onChange={(value) => updateContact(contact.id, { source: value })}
      />

      <label className="block text-2xs text-zinc-500">
        {t("crmPanel.salesStage")}
        <select
          value={contact.stage}
          onChange={(event) =>
            updateContact(contact.id, {
              stage: event.target.value as SalesStage,
            })
          }
          className="ui-control mt-1 w-full px-2.5 text-[13px]"
        >
          {stages.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-2xs text-zinc-500">
        {t("contact.permanentPhone")}
        <select
          value={contact.boundPhoneId ?? ""}
          onChange={(event) =>
            updateContact(contact.id, {
              boundPhoneId: event.target.value || undefined,
            })
          }
          className="ui-control mt-1 w-full px-2.5 text-[13px]"
        >
          <option value="">{t("contact.unbound")}</option>
          {phones.map((phone) => (
            <option key={phone.id} value={phone.id}>
              {phone.name} · {phone.remark}
            </option>
          ))}
        </select>
      </label>

      <ContactTagsNotesEditor contact={contact} compact={compact} />

      <div className="space-y-2 rounded-lg border border-brand/15 bg-brand/5 p-2.5">
        <div className="text-[11px] font-medium text-brand">{t("contact.card")}</div>
        <p className="text-2xs leading-3.5 text-zinc-600">
          {t("contact.cardHint")}
        </p>
        <Field
          label={t("contact.intent")}
          value={contact.aiIntent ?? ""}
          onChange={(value) =>
            updateContact(contact.id, { aiIntent: value || undefined })
          }
        />
        <Field
          label={t("contact.nextStep")}
          value={contact.aiNextStep ?? ""}
          onChange={(value) =>
            updateContact(contact.id, { aiNextStep: value || undefined })
          }
        />
        <label className="block text-2xs text-zinc-500">
          {t("contact.aiSummary")}
          <Textarea
            value={contact.aiSummary ?? ""}
            onChange={(event) =>
              updateContact(contact.id, {
                aiSummary: event.target.value || undefined,
              })
            }
            rows={compact ? 2 : 3}
            className="mt-1"
            placeholder={t("contact.aiSummaryPlaceholder")}
          />
        </label>
        {contact.aiSuggestedStage &&
          contact.aiSuggestedStage !== contact.stage && (
            <div className="flex flex-wrap items-center gap-1.5 text-2xs text-zinc-500">
              <span>
                {t("contact.suggestedStage")}：
                {stages.find((stage) => stage.id === contact.aiSuggestedStage)
                  ?.label || contact.aiSuggestedStage}
              </span>
              <Button
                variant="secondary"
                className="!min-h-6 !px-2 text-2xs"
                onClick={() =>
                  updateContact(contact.id, {
                    stage: contact.aiSuggestedStage,
                  })
                }
              >
                {t("contact.apply")}
              </Button>
            </div>
          )}
        {contact.aiNextStep?.trim() && (
          <Button
            variant="secondary"
            className="!min-h-7 gap-1 !px-2 text-2xs"
            onClick={() => {
              const result = scheduleTomorrowFollowUp(
                contact.id,
                contact.aiNextStep!.trim().slice(0, 120)
              );
              if (result) {
                pushToast(t("contact.nextStepScheduled", { date: result.dueAt }), "success");
              }
            }}
          >
            <CalendarPlus className="h-3 w-3" />
            {t("contact.nextStep")} → {t("contact.tomorrowFollowUp")}
          </Button>
        )}
        {contact.aiInsightAt && (
          <p className="text-2xs text-zinc-600">
            {t("contact.aiSummary")}：{contact.aiInsightAt.slice(0, 16).replace("T", " ")}
          </p>
        )}
      </div>

      <label className="block text-2xs text-zinc-500">
        {t("contact.nextFollowUp")}
        <Input
          type="date"
          value={contact.nextFollowUpAt ?? ""}
          onChange={(event) =>
            updateContact(contact.id, { nextFollowUpAt: event.target.value })
          }
          className="mt-1"
        />
      </label>

      <div className="border-t border-zinc-800/80 pt-3">
        <ActivityTimeline
          contactId={contact.id}
          limit={compact ? 8 : 16}
          compact={compact}
        />
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onChange(draft);
  };

  return (
    <label className="block text-2xs text-zinc-500">
      {label}
      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className="mt-1"
      />
    </label>
  );
}
