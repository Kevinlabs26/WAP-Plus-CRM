import { useState } from "react";
import { baileysPrivacy, baileysUpdatePrivacy } from "@/lib/baileys";
import { Button } from "@/components/ui/primitives";

type Props = { accountId?: string | null };

const fields = [
  ["last", "最后上线", ["all", "contacts", "contact_blacklist", "none"]],
  ["online", "在线状态", ["all", "match_last_seen"]],
  ["profile", "头像", ["all", "contacts", "contact_blacklist", "none"]],
  ["status", "状态", ["all", "contacts", "contact_blacklist", "none"]],
  ["readreceipts", "已读回执", ["all", "none"]],
  ["groupadd", "加入群组", ["all", "contacts", "contact_blacklist"]],
] as const;

export function BaileysPrivacyPanel({ accountId }: Props) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [disappearing, setDisappearing] = useState("0");

  const load = async () => {
    setOpen(true);
    if (Object.keys(values).length) return;
    setBusy(true);
    try {
      const result = await baileysPrivacy(accountId);
      const next = result.privacy || {};
      setValues({
        last: String(next.last || "contacts"),
        online: String(next.online || "match_last_seen"),
        profile: String(next.profile || "contacts"),
        status: String(next.status || "contacts"),
        readreceipts: String(next.readreceipts || "all"),
        groupadd: String(next.groupadd || "contacts"),
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setMessage("");
    try {
      const result = await baileysUpdatePrivacy({
        lastSeen: values.last,
        online: values.online,
        profilePicture: values.profile,
        status: values.status,
        readReceipts: values.readreceipts,
        groupsAdd: values.groupadd,
        defaultDisappearing: disappearing,
      }, accountId);
      const next = result.privacy || {};
      setValues((current) => ({ ...current, ...Object.fromEntries(
        fields.map(([key]) => [key, String(next[key] || current[key] || "")])
      ) }));
      setMessage("已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/50 text-left">
      <button type="button" onClick={() => { if (!open) void load(); else setOpen(false); }} className="w-full cursor-pointer px-3 py-2 text-left text-xs text-zinc-300">
        WhatsApp 隐私设置
      </button>
      {open && <div className="grid grid-cols-2 gap-2 border-t border-zinc-800 p-3">
        {fields.map(([key, label, options]) => (
          <label key={key} className="space-y-1 text-2xs text-zinc-500">
            <span>{label}</span>
            <select
              value={values[key] || options[0]}
              onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
              disabled={busy}
              className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200"
            >
              {options.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        ))}
        <label className="col-span-2 space-y-1 text-2xs text-zinc-500">
          <span>默认阅后即焚</span>
          <select value={disappearing} onChange={(event) => setDisappearing(event.target.value)} disabled={busy} className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200">
            <option value="0">关闭</option>
            <option value="86400">24 小时</option>
            <option value="604800">7 天</option>
            <option value="7776000">90 天</option>
          </select>
        </label>
        <div className="col-span-2 flex items-center justify-between pt-1">
          <span className="text-2xs text-zinc-500">{message}</span>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void save()}>
            {busy ? "处理中…" : "保存隐私设置"}
          </Button>
        </div>
      </div>}
    </div>
  );
}
