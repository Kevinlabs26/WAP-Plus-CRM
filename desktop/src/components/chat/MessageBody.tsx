import { memo, useMemo, type ReactNode } from "react";
import { cn, splitTextWithLinks, splitWhatsAppFormatting } from "@/lib/utils";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { useAppStore } from "@/store/appStore";
import { isWhatsAppCallLink, tryOpenBoundCallLink } from "@/lib/cloneCalls";
import { isTauri } from "@/lib/bridge";

const openingLinks = new Set<string>();

/** 高亮正文里的 @token（与发送时写入的 @显示名 对齐） */
function splitMentions(text: string, mentionLabels?: string[]) {
  const labels = (mentionLabels || [])
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (!text) return [{ type: "text" as const, value: text }];
  // 始终识别 @所有人 / @everyone
  const special = ["@所有人", "@everyone", "@all"];
  const tokens = [
    ...special,
    ...labels.map((l) => (l.startsWith("@") ? l : `@${l.replace(/\s+/g, "")}`)),
  ];
  if (!tokens.length) return [{ type: "text" as const, value: text }];

  const escaped = tokens.map((t) =>
    t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );
  const re = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(re);
  return parts.filter(Boolean).map((p) => {
    const isMen = tokens.some((t) => t.toLowerCase() === p.toLowerCase());
    return isMen
      ? ({ type: "mention" as const, value: p })
      : ({ type: "text" as const, value: p });
  });
}

export const MessageBody = memo(function MessageBody({
  text,
  outbound,
  mentionLabels,
  accountId,
  chatId,
}: {
  text: string;
  outbound?: boolean;
  /** 用于高亮的 @显示名（不含 jid） */
  mentionLabels?: string[];
  accountId?: string;
  chatId?: string;
}) {
  const mentionKey = (mentionLabels || []).join("\0");
  const nodes = useMemo(() => {
    const chunks = splitMentions(text, mentionLabels);
    const out: ReactNode[] = [];
    chunks.forEach((chunk, ci) => {
      if (chunk.type === "mention") {
        out.push(
          <span
            key={`m-${ci}`}
            className={cn(
              "rounded px-0.5 font-medium",
              outbound
                ? "bg-emerald-950/40 text-emerald-100"
                : "bg-sky-500/15 text-sky-300"
            )}
          >
            {chunk.value}
          </span>
        );
        return;
      }
      splitWhatsAppFormatting(chunk.value).forEach((formatted, fi) => {
        const formatClass =
          formatted.type === "bold"
            ? "font-semibold"
            : formatted.type === "italic"
              ? "italic"
              : formatted.type === "strike"
                ? "line-through"
                : undefined;
        const parts = splitTextWithLinks(formatted.value);
        parts.forEach((p, i) => {
          if (p.type !== "link") {
            out.push(
              <span
                key={`t-${ci}-${fi}-${i}`}
                className={formatClass}
              >
                {p.value}
              </span>
            );
            return;
          }
          const isPhone = p.kind === "phone" || p.href.startsWith("tel:");
          const digits = isPhone ? p.value.replace(/\D/g, "") : "";
          const waHref = digits ? `https://wa.me/${digits}` : p.href;
          out.push(
            <a
              key={`l-${ci}-${fi}-${i}`}
              href={isPhone ? waHref : p.href}
              target="_blank"
              rel="noopener noreferrer"
              title={
                isPhone
                  ? `WhatsApp ${p.value}（也可 tel:${p.value}）`
                  : p.href
              }
              className={cn(
                "break-all underline underline-offset-2",
                formatClass,
                outbound
                  ? "text-emerald-200/95 hover:brightness-125"
                  : "text-sky-400 hover:text-sky-300"
              )}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                const href = isPhone ? waHref : p.href;
                const state = useAppStore.getState();
                const owner = accountId || state.chats.find((chat) => chat.id === chatId)?.accountId;
                const key = JSON.stringify([href, owner]);
                if (openingLinks.has(key)) return;
                openingLinks.add(key);
                void (async () => {
                  if (isWhatsAppCallLink(href)) {
                    if (await tryOpenBoundCallLink(href, owner, state.settings.waAccounts || [])) return;
                  }
                  if (isTauri()) await openExternal(href);
                  else window.open(href, "_blank", "noopener,noreferrer");
                })().catch(() => useAppStore.getState().pushToast("无法打开链接，请重试", "error"))
                  .finally(() => { setTimeout(() => openingLinks.delete(key), 1000); });
              }}
            >
              {p.value}
            </a>
          );
        });
      });
    });
    return out;
    // mentionKey 稳定比较标签内容，避免父组件每次 new [] 废掉缓存
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, outbound, mentionKey, accountId, chatId]);

  return <>{nodes}</>;
});
