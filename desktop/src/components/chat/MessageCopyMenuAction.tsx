import { Copy } from "lucide-react";

type MessageCopyMenuActionProps = {
  text: string;
  onCopy: (text: string) => void;
  onClose: () => void;
};

export function MessageCopyMenuAction({
  text,
  onCopy,
  onClose,
}: MessageCopyMenuActionProps) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-zinc-200 hover:bg-zinc-800"
      onClick={() => {
        onCopy(text);
        onClose();
      }}
    >
      <Copy className="h-3.5 w-3.5 text-zinc-400" />
      复制文本
    </button>
  );
}
