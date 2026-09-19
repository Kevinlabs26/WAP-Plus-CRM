import { useState } from "react";
import type { Contact } from "@/types/crm";
import { Button, Input } from "@/components/ui/primitives";
import { useI18n } from "@/i18n";

type Props = {
  phones: { id: string; name: string; remark: string }[];
  onSave: (contact: Omit<Contact, "id">) => void;
  onCancel: () => void;
};

export function AddContactForm({ phones, onSave, onCancel }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [boundPhoneId, setBoundPhoneId] = useState(phones[0]?.id ?? "");

  return (
    <div className="mx-auto max-w-2xl rounded-lg border border-brand/25 bg-brand/5 p-3">
      <div className="mb-2 text-[13px] font-semibold">{t("contact.new")}</div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Input
          placeholder={t("contact.name")}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Input
          placeholder={t("contact.phoneE164")}
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
        />
        <select
          value={boundPhoneId}
          onChange={(event) => setBoundPhoneId(event.target.value)}
          className="ui-control px-2.5 text-[13px]"
        >
          {phones.map((item) => (
            <option key={item.id} value={item.id}>
              {t("contact.bindPhone", { name: item.name })}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-2 flex gap-2">
        <Button
          variant="primary"
          className="!min-h-8 !px-3 text-2xs"
          disabled={!name.trim() || !phone.trim()}
          onClick={() =>
            onSave({
              name: name.trim(),
              phone: phone.trim(),
              tags: [],
              stage: "new",
              boundPhoneId: boundPhoneId || undefined,
            })
          }
        >
          {t("common.save")}
        </Button>
        <Button
          variant="secondary"
          className="!min-h-8 !px-3 text-2xs"
          onClick={onCancel}
        >
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}
