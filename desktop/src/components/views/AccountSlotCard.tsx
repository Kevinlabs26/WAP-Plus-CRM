import {
  Check,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import {
  Button,
  OnlineDot,
} from "@/components/ui/primitives";
import { BaileysConnectCard } from "@/components/settings/BaileysConnectCard";
import type { WaAccount } from "@/types/account";
import { useI18n } from "@/i18n";

export type AccountSlotCardProps = {
  account: WaAccount;
  idx: number;
  isDefaultSend: boolean;
  isConnectionFocus: boolean;
  isViewing: boolean;
  liveUserName: string | null;
  statusText: "connected" | "reconnecting" | "qr" | "error" | "loggedOut";
  online: boolean;
  title: string;
  warmupActive: boolean;
  panelOpen: boolean;
  needsLogin: boolean;
  dragActive: boolean;
  editing: boolean;
  editDraft: string;
  menuOpen: boolean;
  onEditDraftChange: (value: string) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onStartEdit: () => void;
  onCommitRename: () => void;
  onCancelEdit: () => void;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onSetDefault: () => void;
  onToggleWarmupExempt: () => void;
  onRemove: () => void;
  onLogin: () => void;
};

/**
 * 单个 WhatsApp 账号槽卡片：拖动排序 / 重命名 / 设默认 / 删除 ·
 * 当前连接焦点展开 Baileys 面板；发送健康度集中在监测页。
 */
export function AccountSlotCard({
  account: a,
  idx,
  isDefaultSend,
  isConnectionFocus,
  isViewing,
  liveUserName,
  statusText: st,
  online,
  title,
  warmupActive,
  panelOpen,
  needsLogin,
  dragActive,
  editing,
  editDraft,
  menuOpen,
  onEditDraftChange,
  onDragStart,
  onDragEnd,
  onDrop,
  onStartEdit,
  onCommitRename,
  onCancelEdit,
  onToggleMenu,
  onCloseMenu,
  onSetDefault,
  onToggleWarmupExempt,
  onRemove,
  onLogin,
}: AccountSlotCardProps) {
  const { t } = useI18n();
  const name = online ? a.userName || liveUserName || null : null;
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={cn(
        "group relative flex flex-col rounded-2xl border p-3.5 transition-all",
        dragActive && "opacity-70 ring-1 ring-brand/40",
        online
          ? "border-brand/35 bg-gradient-to-b from-brand/10 to-zinc-900/80"
          : "border-zinc-800/90 bg-zinc-900/50 hover:border-zinc-700"
      )}
    >
      <div className="flex flex-wrap items-start gap-2.5">
        <button
          type="button"
          className="mt-1 cursor-grab text-zinc-600 opacity-0 transition-opacity active:cursor-grabbing group-hover:opacity-100"
          title={t("phones.dragSort")}
          aria-label={t("phones.dragSort")}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <Avatar
          name={name || a.label || t("phones.accountSlotLabel", { index: idx + 1 })}
          seed={a.id}
          src={a.avatarUrl}
          size="lg"
          online={online}
        />
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              autoFocus
              value={editDraft}
              onChange={(e) => onEditDraftChange(e.target.value)}
              onBlur={onCommitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") onCommitRename();
                if (e.key === "Escape") onCancelEdit();
              }}
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-[12px] text-zinc-100 outline-none ring-brand/30 focus:ring-1"
            />
          ) : (
            <>
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="truncate text-[13px] font-semibold text-zinc-50">
                  {title}
                </span>
                {online && (
                  <span className="shrink-0 rounded-full bg-brand/15 px-1.5 py-0.5 text-2xs font-medium text-brand">
                    {t("phones.status.connected")}
                  </span>
                )}
                {isDefaultSend && (
                  <span className="shrink-0 rounded-full bg-zinc-700/80 px-1.5 py-0.5 text-2xs font-medium text-zinc-300">
                    {t("phones.defaultSend")}
                  </span>
                )}
                {isViewing && (
                  <span className="shrink-0 rounded-full bg-sky-500/10 px-1.5 py-0.5 text-2xs font-medium text-sky-300">
                    {t("phones.currentView")}
                  </span>
                )}
                {isConnectionFocus && (
                  <span className="shrink-0 rounded-full bg-violet-500/10 px-1.5 py-0.5 text-2xs font-medium text-violet-300">
                    {t("phones.connectionManagement")}
                  </span>
                )}
                {warmupActive && (
                  <span className="shrink-0 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-2xs font-medium text-amber-300">
                    {t("phones.warmup")}
                  </span>
                )}
                {a.warmupExempt && (
                  <span className="shrink-0 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-2xs font-medium text-emerald-300">
                    {t("phones.mature")}
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-2xs text-zinc-500">
                <OnlineDot online={online} />
                <span>{t(`phones.status.${st}` as const)}</span>
                {a.phoneE164 && <span>· {a.phoneE164}</span>}
              </div>
            </>
          )}
        </div>
        <div
          className="relative shrink-0 self-start"
          data-account-slot-menu
        >
          <button
            type="button"
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label={t("phones.more")}
            onClick={onToggleMenu}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menuOpen && (
            <div
              className="absolute right-0 top-8 z-20 min-w-[9.5rem] overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl"
              onMouseLeave={onCloseMenu}
            >
              {!isDefaultSend && (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-brand hover:bg-zinc-800"
                  onClick={() => {
                    onCloseMenu();
                    onSetDefault();
                  }}
                >
                  <Check className="h-3.5 w-3.5" />
                  {t("phones.setDefault")}
                </button>
              )}
              {isDefaultSend && (
                <div className="flex items-center gap-2 px-3 py-1.5 text-[12px] text-zinc-500">
                  <Check className="h-3.5 w-3.5 text-brand" />
                  {t("phones.alreadyDefault")}
                </div>
              )}
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-zinc-200 hover:bg-zinc-800"
                onClick={() => {
                  onCloseMenu();
                  onToggleWarmupExempt();
                }}
              >
                <Check className="h-3.5 w-3.5 text-zinc-500" />
                {a.warmupExempt ? t("phones.restoreProtection") : t("phones.markMature")}
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-zinc-200 hover:bg-zinc-800"
                onClick={() => {
                  onCloseMenu();
                  onStartEdit();
                }}
              >
                <Pencil className="h-3.5 w-3.5 text-zinc-500" />
                {t("phones.rename")}
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-rose-300 hover:bg-rose-500/10"
                onClick={() => {
                  onCloseMenu();
                  onRemove();
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t("common.delete")}
              </button>
            </div>
          )}
        </div>
      </div>

      {panelOpen ? (
        <div className="mt-3 border-t border-zinc-800/60 pt-3">
          {!isDefaultSend && (
            <button
              type="button"
              className="mb-2 inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900/50 px-2 py-1 text-[11px] text-zinc-300 hover:border-brand/40 hover:text-brand"
              onClick={onSetDefault}
            >
              <Check className="h-3 w-3" />
              {t("phones.setDefault")}
            </button>
          )}
          <BaileysConnectCard variant="embedded" accountId={a.id} />
        </div>
      ) : (
        <div className="mt-3">
          <Button
            variant="primary"
            className="!min-h-8 w-full text-2xs"
            onClick={onLogin}
          >
            {needsLogin ? t("phones.scanLogin") : online ? t("phones.manageAccount") : t("phones.connectAccount")}
          </Button>
        </div>
      )}
    </div>
  );
}
