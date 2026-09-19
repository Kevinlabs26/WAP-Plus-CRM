import { Battery } from "lucide-react";
import {
  ListRow,
  OnlineDot,
  SectionLabel,
} from "@/components/ui/primitives";
import type { PhoneDevice } from "@/types/crm";
import { useI18n } from "@/i18n";

type Props = {
  phones: PhoneDevice[];
  selectedPhoneId?: string | null;
  onSelect: (id: string) => void;
};

export function PhoneListSection({ phones, selectedPhoneId, onSelect }: Props) {
  const { t } = useI18n();
  return (
    <section className="border-b border-zinc-800/90 p-2.5">
      <SectionLabel>{t("phones.title")}</SectionLabel>
      <ul className="space-y-0.5">
        {phones.map((p) => (
          <li key={p.id}>
            <ListRow
              active={selectedPhoneId === p.id}
              onClick={() => onSelect(p.id)}
              className="flex-col items-stretch !py-1.5"
            >
              <div className="flex w-full items-center justify-between gap-1">
                <span className="truncate text-[13px] font-medium">
                  {p.name}
                </span>
                <span className="flex items-center gap-1 text-2xs text-zinc-500">
                  <OnlineDot online={p.online} />
                  {p.online ? t("phones.online") : t("phones.offline")}
                </span>
              </div>
              <div className="flex items-center justify-between text-2xs text-zinc-500">
                <span className="truncate">{p.remark}</span>
                <span className="inline-flex items-center gap-0.5">
                  <Battery className="h-3 w-3" />
                  {p.battery}%
                </span>
              </div>
            </ListRow>
          </li>
        ))}
        {phones.length === 0 && (
          <li className="px-1 py-2 text-2xs text-zinc-600">
            {t("phones.waitingBridge")}
          </li>
        )}
      </ul>
    </section>
  );
}
