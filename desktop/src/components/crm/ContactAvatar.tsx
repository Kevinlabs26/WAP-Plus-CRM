import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Contact } from "@/types/crm";
import { useAppStore } from "@/store/appStore";
import { Avatar } from "@/components/ui/Avatar";
import { ImagePreviewDialog } from "@/components/chat/ImagePreviewDialog";
import { baileysFetchAvatar } from "@/lib/baileys";
import { displayContactLabel } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { requestImageGeneration } from "@/lib/imageGenerationRequest";
import { uploadContactAvatar } from "@/lib/googleDrive";

export function ContactAvatar({ contact, accountId }: { contact: Contact; accountId?: string | null }) {
  const { t } = useI18n();
  const sendChannel = useAppStore((s) => s.settings.sendChannel);
  const owner = accountId || contact.accountId || contact.boundPhoneId || "";
  const context = `${contact.id}|${owner}|${contact.channelAddress || ""}|${contact.phone}`;
  const currentContext = useRef(context);
  const requestId = useRef(0);
  if (currentContext.current !== context) {
    currentContext.current = context;
    requestId.current++;
  }
  const [preview, setPreview] = useState<{
    context: string; src: string; fallbackSrc?: string; alt: string; loading: boolean; error?: string;
  } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { setMenu(null); }, [context]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setMenu(null); triggerRef.current?.focus(); } };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [menu]);
  useEffect(() => () => { requestId.current++; }, []);
  const name = displayContactLabel(contact.name, contact.phone, contact.channelAddress, undefined, { isGroup: contact.isGroup });
  const fallbackSrc = contact.avatarUrl || undefined;
  const src = contact.avatarFullUrl || fallbackSrc || "";
  const canFetch = sendChannel !== "android_bridge" && Boolean(contact.channelAddress || contact.phone);
  const close = () => { requestId.current++; setPreview(null); };
  const open = async () => {
    const request = ++requestId.current;
    setPreview({ context, src, fallbackSrc, alt: name, loading: canFetch });
    if (!canFetch) return;
    try {
      const settings = useAppStore.getState().settings;
      const result = await baileysFetchAvatar({
        jid: contact.channelAddress || undefined,
        phone: contact.phone || undefined,
        quality: "image",
        accountId: owner || settings.liveBaileysAccountId || settings.activeAccountId,
      });
      if (requestId.current !== request || currentContext.current !== context) return;
      const full = result.avatarFullUrl || result.avatarUrl;
      setPreview({ context, src: full || src, fallbackSrc, alt: name, loading: false,
        error: full || src ? undefined : t("avatar.unavailable") });
    } catch {
      if (requestId.current !== request || currentContext.current !== context) return;
      setPreview({ context, src, fallbackSrc, alt: name, loading: false,
        error: src ? undefined : t("avatar.loadFailed") });
    }
  };
  const createCard = async () => {
    setMenu(null);
    const request = ++requestId.current;
    let source = src;
    if (canFetch) {
      try {
        const result = await baileysFetchAvatar({ jid: contact.channelAddress || undefined, phone: contact.phone || undefined, quality: "image", accountId: owner || undefined });
        source = result.avatarFullUrl || result.avatarUrl || source;
      } catch { /* The cached avatar can still be used. */ }
    }
    if (requestId.current !== request || currentContext.current !== context) return;
    const store = useAppStore.getState();
    if (!source) { store.pushToast(t("avatar.unavailable"), "error"); return; }
    if (!store.selectedContactId && !store.selectedChatId) store.setSelectedContact(contact.id);
    try { requestImageGeneration({ source, title: name, mode: "portrait", chatId: store.selectedContactId === contact.id ? store.selectedChatId : null }); }
    catch (error) { store.pushToast(String(error), "error"); }
  };

  return <>
    <button ref={triggerRef} type="button" onClick={() => void open()} disabled={!src && !canFetch}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); setMenu({ x: event.clientX || rect.left, y: event.clientY || rect.bottom }); }}
      className="shrink-0 rounded-full cursor-zoom-in focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-default"
      title={t("avatar.view", { name })} aria-label={t("avatar.view", { name })}>
      <Avatar name={name} seed={contact.phone || contact.id} src={contact.avatarUrl || contact.avatarFullUrl} size="lg" />
    </button>
    {menu && createPortal(<div ref={menuRef} role="menu" className="fixed z-[230] w-56 max-w-[calc(100vw-8px)] rounded-lg border border-zinc-700 bg-zinc-900 p-1 text-xs text-zinc-100 shadow-xl" style={{ left: Math.max(4, Math.min(menu.x, window.innerWidth - 230)), top: Math.max(4, Math.min(menu.y, window.innerHeight - 88)) }}>
      <button autoFocus type="button" role="menuitem" className="block w-full rounded px-3 py-2 text-left hover:bg-zinc-800" onClick={() => void createCard()}>{t("gallery.createAvatarCard")}</button>
      <button type="button" role="menuitem" className="block w-full rounded px-3 py-2 text-left hover:bg-zinc-800" onClick={() => { setMenu(null); void uploadContactAvatar(contact,owner); }}>{t("cloud.upload")}</button>
    </div>, document.body)}
    {preview?.context === context && createPortal(
      <ImagePreviewDialog preview={preview} onClose={close} className="z-[220]" />,
      document.body
    )}
  </>;
}
