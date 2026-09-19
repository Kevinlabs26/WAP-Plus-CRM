import { memo, useCallback } from "react";
import { Virtuoso } from "react-virtuoso";
import { Link2 } from "lucide-react";
import { displayContactLabel, displayPhone } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import { Badge, ListRow } from "@/components/ui/primitives";
import type { ChatPreview, Contact } from "@/types/crm";
import { useI18n } from "@/i18n";

type ContactSidebarListProps = {
  contacts: Contact[];
  chatByContactId: Map<string, ChatPreview>;
  selectedContactId: string | null;
  query: string;
  onOpenContact: (contactId: string) => void;
};

const ContactSidebarRow = memo(function ContactSidebarRow({
  contact,
  relatedChat,
  active,
  onOpenContact,
}: {
  contact: Contact;
  relatedChat?: ChatPreview;
  active: boolean;
  onOpenContact: (contactId: string) => void;
}) {
  const label = displayContactLabel(
    contact.name,
    contact.phone,
    contact.channelAddress,
    relatedChat?.lastMessage,
    { isGroup: !!contact.isGroup }
  );
  const phoneLabel = displayPhone(contact.phone);

  return (
    <div className="px-0 pb-0.5">
      <ListRow
        active={active}
        onClick={() => onOpenContact(contact.id)}
        className="!items-center gap-2.5 !py-1.5"
      >
        <Avatar
          name={label}
          seed={contact.phone || contact.id}
          src={contact.avatarUrl}
          size="sm"
        />
        <div className="min-w-0 flex-1">
          <div className="flex w-full items-center justify-between gap-1">
            <span className="truncate text-[13px]">{label}</span>
            {contact.boundPhoneId ? (
              <Link2 className="h-3 w-3 shrink-0 text-brand/80" />
            ) : null}
          </div>
          <span className="truncate text-2xs text-zinc-500">
            {phoneLabel && phoneLabel !== label
              ? phoneLabel
              : contact.company || "WhatsApp"}
          </span>
          {contact.tags[0] ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {contact.tags.slice(0, 2).map((tag) => (
                <Badge key={tag}>{tag}</Badge>
              ))}
            </div>
          ) : null}
        </div>
      </ListRow>
    </div>
  );
});

export const ContactSidebarList = memo(function ContactSidebarList({
  contacts,
  chatByContactId,
  selectedContactId,
  query,
  onOpenContact,
}: ContactSidebarListProps) {
  const { t } = useI18n();
  const itemContent = useCallback(
    (_i: number, contact: Contact) => (
      <ContactSidebarRow
        contact={contact}
        relatedChat={chatByContactId.get(contact.id)}
        active={selectedContactId === contact.id}
        onOpenContact={onOpenContact}
      />
    ),
    [chatByContactId, onOpenContact, selectedContactId]
  );

  if (contacts.length === 0) {
    return (
      <div className="space-y-2 px-1 py-3 text-2xs leading-5 text-zinc-500">
        {query ? t("sidebar.noResults") : t("sidebar.noContacts")}
      </div>
    );
  }

  return (
    <Virtuoso
      className="h-full"
      data={contacts}
      computeItemKey={(_i, contact) => contact.id}
      defaultItemHeight={58}
      itemContent={itemContent}
    />
  );
});
