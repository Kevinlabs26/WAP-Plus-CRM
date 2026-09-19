import { Download, ExternalLink, FileText, Image as ImageIcon, Link2, Loader2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Message } from "@/types/crm";
import { loadCompleteChatMessages } from "@/lib/chatTranscript";
import { extractChatLinks } from "@/lib/chatLinks";
import { inferMediaType } from "./messageMediaUtils";
import { useI18n } from "@/i18n";

type Props = {
  chatId: string;
  title: string;
  memoryMessages: Message[];
  onClose: () => void;
  onPreviewImage: (src: string, alt: string) => void;
};

export function ChatMediaPanel({
  chatId,
  title,
  memoryMessages,
  onClose,
  onPreviewImage,
}: Props) {
  const { t } = useI18n();
  const [messages, setMessages] = useState<Message[]>([]);
  const [memoryAtOpen] = useState(memoryMessages);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<"media" | "files" | "links">("media");

  useEffect(() => {
    let cancelled = false;
    void loadCompleteChatMessages(chatId, memoryAtOpen)
      .then((items) => {
        if (!cancelled) setMessages(items);
      })
      .catch(() => !cancelled && setFailed(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [chatId, memoryAtOpen]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  const { media, files, links } = useMemo(() => {
    const media: Message[] = [];
    const files: Message[] = [];
    for (const message of messages) {
      const kind = inferMediaType(message);
      if (["image", "sticker", "video", "gif"].includes(kind || "")) {
        media.push(message);
      } else if (kind) {
        files.push(message);
      }
    }
    return { media, files, links: extractChatLinks(messages) };
  }, [messages]);
  const visible = tab === "media" ? media : files;

  return (
    <div className="fixed inset-0 z-[90] flex justify-end bg-black/55" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside role="dialog" aria-modal="true" aria-label={t("tooltip.mediaFiles")} className="flex h-full w-full max-w-md flex-col border-l border-zinc-700 bg-zinc-950 shadow-2xl">
        <header className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
          <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-zinc-100">{t("tooltip.mediaFiles")}</h2>
            <p className="truncate text-2xs text-zinc-500">{title}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t("tooltip.close")} className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="grid grid-cols-3 border-b border-zinc-800 p-1">
          {(["media", "files", "links"] as const).map((id) => (
            <button key={id} type="button" onClick={() => setTab(id)} className={`rounded-md px-2 py-1.5 text-xs ${tab === id ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-200"}`}>
              {id === "media" ? `${t("multi.mediaImage")} ${media.length}` : id === "files" ? `${t("multi.mediaFile")} ${files.length}` : `${t("chat.links")} ${links.length}`}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex h-40 items-center justify-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" />{t("chat.loadingHistory")}</div>
          ) : failed ? (
            <div className="flex h-40 items-center justify-center text-xs text-rose-400">{t("chat.mediaLoadFailed")}</div>
          ) : (tab === "links" ? links.length : visible.length) === 0 ? (
            <div className="flex h-40 items-center justify-center text-xs text-zinc-600">{t("chat.noMediaItems", { kind: tab === "media" ? t("multi.mediaImage") : tab === "files" ? t("multi.mediaFile") : t("chat.links") })}</div>
          ) : tab === "media" ? (
            <div className="grid grid-cols-3 gap-2">
              {visible.map((message) => {
                const kind = inferMediaType(message);
                const src = message.mediaUrl || message.mediaThumbUrl;
                return kind === "video" ? (
                  <div key={message.id} className="aspect-square overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
                    {src ? <video src={src} controls preload="metadata" className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-2xs text-zinc-600">{t("chat.videoNotCached")}</span>}
                  </div>
                ) : (
                  <button key={message.id} type="button" disabled={!src} title={src ? t("tooltip.viewMedia") : t("tooltip.mediaNotCached")} onClick={() => src && onPreviewImage(src, message.mediaCaption || kind || t("multi.mediaImage"))} className="aspect-square overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 disabled:opacity-45">
                    {src && (kind === "image" || kind === "sticker" || kind === "gif") ? <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" /> : <span className="flex h-full flex-col items-center justify-center gap-1 text-2xs text-zinc-500"><ImageIcon className="h-5 w-5" />{kind || t("multi.mediaImage")}</span>}
                  </button>
                );
              })}
            </div>
          ) : tab === "files" ? (
            <div className="space-y-1.5">
              {visible.map((message) => {
                const label = message.mediaFileName || message.mediaCaption || inferMediaType(message) || "文件";
                return (
                  <div key={message.id} className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-2">
                    <FileText className="h-4 w-4 shrink-0 text-zinc-500" />
                    <div className="min-w-0 flex-1"><p className="truncate text-xs text-zinc-200">{label}</p><p className="text-2xs text-zinc-600">{new Date(message.sentAt).toLocaleString("zh-CN")}</p></div>
                    {message.mediaUrl && <a href={message.mediaUrl} download={message.mediaFileName || undefined} aria-label={t("tooltip.saveFile")} className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-brand"><Download className="h-3.5 w-3.5" /></a>}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-1.5">
              {links.map((link) => (
                <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-2 hover:border-zinc-700 hover:bg-zinc-900">
                  <Link2 className="h-4 w-4 shrink-0 text-brand" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-zinc-200">{link.host}</p>
                    <p className="truncate text-2xs text-zinc-500">{link.url}</p>
                    <p className="text-2xs text-zinc-600">{new Date(link.sentAt).toLocaleString("zh-CN")}</p>
                  </div>
                  <ExternalLink className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
                </a>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
