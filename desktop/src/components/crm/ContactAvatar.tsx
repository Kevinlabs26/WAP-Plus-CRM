import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Contact } from "@/types/crm";
import { useAppStore } from "@/store/appStore";
import { Avatar } from "@/components/ui/Avatar";
import { ImagePreviewDialog } from "@/components/chat/ImagePreviewDialog";
import { baileysFetchAvatar } from "@/lib/baileys";
import { displayContactLabel } from "@/lib/utils";
import { useI18n } from "@/i18n";

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

  return <>
    <button type="button" onClick={() => void open()} disabled={!src && !canFetch}
      className="shrink-0 rounded-full cursor-zoom-in focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-default"
      title={t("avatar.view", { name })} aria-label={t("avatar.view", { name })}>
      <Avatar name={name} seed={contact.phone || contact.id} src={contact.avatarUrl || contact.avatarFullUrl} size="lg" />
    </button>
    {preview?.context === context && createPortal(
      <ImagePreviewDialog preview={preview} onClose={close} className="z-[220]" />,
      document.body
    )}
  </>;
}
