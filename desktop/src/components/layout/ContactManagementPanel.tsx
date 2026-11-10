import { useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { Download, FilePlus2, Plus, Trash2, MessageSquare } from "lucide-react";
import { useAppStore, flushPersist } from "@/store/appStore";
import { Button, Input } from "@/components/ui/primitives";
import { ContactImportModal } from "@/components/settings/ContactImportModal";
import { contactsToCsv, downloadText } from "@/lib/exportData";
import { contactSendablePhone } from "@/lib/broadcastTemplate";
import { contactCopiesForAccount } from "@/lib/contactManagement";
import { formatAccountDisplay } from "@/lib/accountLabels";
import { baileysSaveContacts } from "@/lib/baileys";
import { useI18n } from "@/i18n";
import type { Contact } from "@/types/crm";
import type { WaAccount } from "@/types/account";

export function ContactManagementPanel({contacts, accounts, accountId, connectedAccountIds, isBaileys, onPaste}: {
  contacts: Contact[]; accounts: WaAccount[]; accountId: string; connectedAccountIds: string[];
  isBaileys: boolean; onPaste: (accountId: string) => void;
}) {
  const {t} = useI18n();
  const [selected, setSelected] = useState(new Set<string>());
  const [target, setTarget] = useState(accountId || accounts[0]?.id || "");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [tag, setTag] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const people = useMemo(() => contacts.filter(contact => !contact.isGroup && !contact.channelAddress?.endsWith("@g.us")), [contacts]);
  const picked = people.filter(contact => selected.has(contact.id));
  const ids = picked.map(contact => contact.id);
  useEffect(() => {
    setSelected(new Set());
    if (!savingRef.current) setTarget(accountId || accounts[0]?.id || "");
  }, [accountId]);
  useEffect(() => {
    if (!savingRef.current && !accounts.some(account => account.id === target)) setTarget(accountId || accounts[0]?.id || "");
  }, [accountId, accounts, target]);
  const toggle = (id: string) => setSelected(current => {
    const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next;
  });
  const saveToAccount = async () => {
    const state = useAppStore.getState();
    if (savingRef.current || !picked.length) return;
    if (!target || !connectedAccountIds.includes(target)) { state.pushToast(t("batchContacts.selectConnectedAccount"), "error"); return; }
    const byPhone = new Map<string, Contact>();
    for (const contact of picked) { const value = contactSendablePhone(contact); if (value) byPhone.set(value, contact); }
    if (!byPhone.size) { state.pushToast(t("batchContacts.selectValid"), "error"); return; }
    savingRef.current = true; setSaving(true);
    try {
      const result = await baileysSaveContacts(target, [...byPhone].map(([phoneE164, contact]) => ({name: contact.name.trim() || phoneE164, phoneE164})));
      const current = useAppStore.getState();
      const copies = contactCopiesForAccount([...byPhone.values()], current.contacts, target, result.savedPhones,
        current.settings.liveBaileysAccountId || current.settings.activeAccountId);
      if (copies.length) current.importContacts(copies);
      await flushPersist(useAppStore.getState);
      current.pushToast(t("contactManage.saved", {saved: result.saved, failed: result.failed, skipped: picked.length - byPhone.size}), result.failed ? "error" : "success");
    } catch (error) { useAppStore.getState().pushToast(String(error), "error"); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const remove = async () => {
    const state = useAppStore.getState();
    const snapshot = [...ids];
    if (!snapshot.length || !await state.requestConfirm({title: t("contactManage.deleteTitle", {count: snapshot.length}),
      description: t("contactManage.deleteHint"), confirmLabel: t("common.delete"), tone: "danger"})) return;
    state.deleteContactsLocal(snapshot); setSelected(new Set());
  };
  const exportPicked = () => downloadText(`contacts-${new Date().toISOString().slice(0,10)}.csv`,
    `\ufeff${contactsToCsv(picked)}`, "text/csv;charset=utf-8");
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="shrink-0 space-y-2 border-b border-zinc-800/70 pb-2 text-[12px]">
      <div className="flex items-center gap-1">
        {[
          {Icon: Plus, label: t("contact.new"), run: () => setAdding(value => !value)},
          {Icon: FilePlus2, label: t("crm.import"), run: () => setImporting(true), disabled: isBaileys && !target},
          {Icon: Download, label: t("crm.export"), run: exportPicked, disabled: !picked.length},
          {Icon: Trash2, label: t("common.delete"), run: () => void remove(), disabled: !picked.length},
        ].map(({Icon, label, run, disabled}) => <button key={label} type="button" aria-label={label} title={label}
          disabled={saving || disabled} onClick={run} className="rounded-md p-2 text-zinc-400 hover:bg-zinc-800 disabled:opacity-40"><Icon className="h-4 w-4" /></button>)}
        <button type="button" disabled={saving} onClick={() => onPaste(target)} className="ml-auto text-brand disabled:opacity-40">{t("contactManage.paste")}</button>
      </div>
      {isBaileys && <label className="block text-zinc-400">{t("contactManage.target")}
        <select className="ui-control mt-1 h-8 w-full px-2" aria-label={t("contactManage.target")} disabled={saving} value={target} onChange={event => setTarget(event.target.value)}>
          <option value="">{t("batchContacts.selectConnectedAccount")}</option>
          {accounts.map((account, index) => <option key={account.id} value={account.id}>{formatAccountDisplay({...account, index1: index + 1})}{connectedAccountIds.includes(account.id) ? "" : ` · ${t("common.offline")}`}</option>)}
        </select>
      </label>}
      {adding && <form className="space-y-1.5" onSubmit={event => {
        event.preventDefault(); const normalized = contactSendablePhone({phone} as Contact);
        if (!normalized || !name.trim() || isBaileys && !target) return;
        useAppStore.getState().addContact({name: name.trim(), phone: normalized, tags: [], stage: "new", source: "manual",
          ...(isBaileys ? {accountId: target} : {boundPhoneId: useAppStore.getState().selectedPhoneId || undefined})});
        setName(""); setPhone(""); setAdding(false);
      }}>
        <Input aria-label={t("contact.name")} placeholder={t("contact.name")} maxLength={100} value={name} onChange={event => setName(event.target.value)} />
        <Input aria-label={t("contact.phoneE164")} placeholder={t("contact.phoneE164")} value={phone} onChange={event => setPhone(event.target.value)} />
        <Button type="submit" variant="primary" disabled={!name.trim() || !contactSendablePhone({phone} as Contact) || isBaileys && !target}>{t("common.save")}</Button>
      </form>}
      <label className="flex items-center gap-2 text-zinc-400"><input type="checkbox" disabled={saving || !people.length}
        checked={people.length > 0 && picked.length === people.length} onChange={event => setSelected(event.target.checked ? new Set(people.map(contact => contact.id)) : new Set())} />
        {t("contactManage.selected", {count: picked.length})}
      </label>
      {!!picked.length && <>
        <div className="flex gap-1"><Input value={tag} placeholder={t("crm.addTagPlaceholder")} aria-label={t("crm.addTagPlaceholder")} onChange={event => setTag(event.target.value)} />
          <Button disabled={saving || !tag.trim()} onClick={() => {useAppStore.getState().batchUpdateContacts(ids, {}, {mergeTags: [tag.trim()]});setTag("");}}>{t("crm.addTag")}</Button></div>
        <div className="flex gap-1"><input type="date" aria-label={t("crm.schedule")} value={dueAt} onChange={event => setDueAt(event.target.value)} className="ui-control min-w-0 flex-1 px-2" />
          <Button disabled={saving || !dueAt} onClick={() => useAppStore.getState().scheduleFollowUps(ids, dueAt)}>{t("crm.schedule")}</Button></div>
        {isBaileys && <Button className="w-full" variant="primary" disabled={saving || !connectedAccountIds.includes(target)} onClick={() => void saveToAccount()}>
          {t(saving ? "common.saving" : "contactManage.saveAccount")}
        </Button>}
      </>}
      <p role="status" className="text-[11px] text-zinc-500">{t(saving ? "contactManage.saving" : "contactManage.hint")}</p>
    </div>
    <Virtuoso className="min-h-0 flex-1" data={people} computeItemKey={(_, contact) => contact.id} defaultItemHeight={68}
      itemContent={(_, contact) => <div className="flex items-center gap-2 border-b border-zinc-800/50 py-2">
        <input type="checkbox" disabled={saving} aria-label={t("contactManage.select", {name: contact.name || contact.phone})}
          checked={selected.has(contact.id)} onChange={() => toggle(contact.id)} />
        <div className="min-w-0 flex-1"><input key={`${contact.id}:${contact.name}`} defaultValue={contact.name} maxLength={100} disabled={saving}
          aria-label={t("contact.name")} className="w-full rounded bg-transparent p-1 text-[13px] outline-none focus:bg-zinc-900 focus:ring-1 focus:ring-brand"
          onBlur={event => {const value=event.target.value.trim(); if (value && value !== contact.name) useAppStore.getState().updateContact(contact.id, {name: value}); else event.target.value=contact.name;}} />
          <div className="truncate pl-1 text-[11px] text-zinc-500">{contact.phone}</div>
          {!!contact.tags.length && <div className="truncate pl-1 text-[11px] text-brand">{contact.tags.join(" · ")}</div>}
        </div>
        <button type="button" title={t("nav.chats")} aria-label={t("nav.chats")} onClick={() => useAppStore.getState().openContactWorkspace(contact.id)} className="p-1 text-zinc-500 hover:text-brand"><MessageSquare className="h-4 w-4" /></button>
      </div>} />
    {!people.length && <p className="py-3 text-[12px] text-zinc-500">{t("sidebar.noContacts")}</p>}
    <ContactImportModal open={importing} accountId={isBaileys ? target : undefined} onClose={() => setImporting(false)} />
  </div>;
}
