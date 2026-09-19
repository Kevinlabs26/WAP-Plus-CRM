import { cn } from "@/lib/utils";
import { RefreshCw } from "lucide-react";

type MessageReloadMediaMenuActionProps = {
  busy: boolean;
  onReload: () => void;
  onClose: () => void;
};

export function MessageReloadMediaMenuAction({
  busy,
  onReload,
  onClose,
}: MessageReloadMediaMenuActionProps) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-zinc-200 hover:bg-zinc-800"
      disabled={busy}
      onClick={() => {
        onClose();
        onReload();
      }}
    >
      <RefreshCw
        className={cn(
          "h-3.5 w-3.5 text-zinc-400",
          busy && "animate-spin"
        )}
      />
      重新加载媒体
    </button>
  );
}
