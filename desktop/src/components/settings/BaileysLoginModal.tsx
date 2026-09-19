import { X } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { Button } from "@/components/ui/primitives";
import { isWaAccountConnected } from "@/lib/accountConnection";
import { BaileysConnectCard } from "./BaileysConnectCard";
import { useI18n } from "@/i18n";

/**
 * 顶栏一点即开的扫码小窗：打开后由卡片自动拉码。
 */
export function BaileysLoginModal() {
  const { t } = useI18n();
  const open = useAppStore((s) => s.baileysLoginOpen);
  const setOpen = useAppStore((s) => s.setBaileysLoginOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const settings = useAppStore((s) => s.settings);
  const connection = useAppStore((s) => s.baileysUi.connection);
  const accountId =
    settings.accountViewMode?.type === "account"
      ? settings.accountViewMode.accountId
      : settings.liveBaileysAccountId || settings.activeAccountId;
  const connected = isWaAccountConnected(
    settings.waAccounts,
    accountId,
    settings.liveBaileysAccountId,
    connection
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-6 backdrop-blur-[2px]"
      onClick={() => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <div
        className="max-h-[86vh] w-full max-w-[30rem] overflow-y-auto rounded-2xl border border-zinc-700/90 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={connected ? t("baileysLogin.manage") : t("baileysLogin.scan")}
      >
        <div className="flex h-10 items-center justify-between border-b border-zinc-800 px-3">
          <div className="text-[13px] font-semibold">
            {connected ? t("baileysLogin.manage") : t("baileysLogin.connect")}
          </div>
          <Button
            variant="ghost"
            className="w-8 !px-0"
            onClick={() => setOpen(false)}
            title={t("common.close")}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="p-3">
          <BaileysConnectCard accountId={accountId} autoStart compact />
          <button
            type="button"
            className="mt-3 w-full rounded-lg border border-zinc-800 py-2 text-center text-2xs text-zinc-500 hover:border-zinc-700 hover:text-zinc-300"
            onClick={() => {
              setOpen(false);
              setSettingsOpen(true);
            }}
          >
            {t("baileysLogin.openSettings")}
          </button>
        </div>
      </div>
    </div>
  );
}
