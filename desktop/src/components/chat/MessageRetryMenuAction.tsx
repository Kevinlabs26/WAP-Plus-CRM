import { RotateCcw } from "lucide-react";

type Props = {
  messageId: string;
  onRetry: (messageId: string) => void;
  onClose: () => void;
};

export function MessageRetryMenuAction({
  messageId,
  onRetry,
  onClose,
}: Props) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-zinc-200 hover:bg-zinc-800"
      onClick={() => {
        onRetry(messageId);
        onClose();
      }}
    >
      <RotateCcw className="h-3.5 w-3.5 text-zinc-400" />
      重新发送
    </button>
  );
}
