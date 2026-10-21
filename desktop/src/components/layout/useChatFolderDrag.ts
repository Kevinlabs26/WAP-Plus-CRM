import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useAppStore, type ChatFolder } from "@/store/appStore";
import { useI18n } from "@/i18n";

type PointerDrag = {
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  scroller: HTMLElement | null;
} & ({ kind: "chat"; chatId: string; chatIds: string[] } | { kind: "folder"; folderId: string });

export function useChatFolderDrag({ chatFolders }: { chatFolders: ChatFolder[] }) {
  const { t } = useI18n();
  const translateRef = useRef(t);
  translateRef.current = t;
  const session = useRef<PointerDrag | null>(null);
  const suppressClick = useRef(false);
  const [drag, setDrag] = useState<PointerDrag | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [folderDropTarget, setFolderDropTarget] = useState<string | null>(null);

  useEffect(() => {
    let frame = 0;
    let lastFrame = 0;
    const atPoint = (cur: PointerDrag) => document.elementFromPoint(cur.x, cur.y)
      ?.closest<HTMLElement>(cur.kind === "chat" ? "[data-chat-folder-drop]" : "[data-folder-reorder-target]");
    const folderTarget = (cur: PointerDrag, element: HTMLElement | null | undefined) => {
      if (cur.kind !== "folder") return null;
      const folders = useAppStore.getState().settings.chatFolders || [];
      const source = folders.find(f => f.id === cur.folderId);
      const target = folders.find(f => f.id === element?.dataset.folderReorderTarget);
      return source && target && source.id !== target.id && source.parentId === target.parentId
        && source.scope?.type === target.scope?.type
        && (source.scope?.type !== "account" || (target.scope?.type === "account" && source.scope.accountId === target.scope.accountId))
        ? target : null;
    };
    const updateTarget = (cur: PointerDrag) => {
      const element = atPoint(cur);
      if (cur.kind === "chat") setDropTarget(element?.dataset.chatFolderDrop || null);
      else setFolderDropTarget(folderTarget(cur, element)?.id || null);
    };
    const reset = () => {
      session.current = null;
      setDrag(null);
      setDropTarget(null);
      setFolderDropTarget(null);
      window.cancelAnimationFrame(frame);
      frame = 0;
      lastFrame = 0;
    };
    const cancel = () => { reset(); suppressClick.current = false; };
    const scroll = (now: number) => {
      const cur = session.current;
      if (!cur?.active) return;
      const scroller = cur.scroller;
      if (scroller?.isConnected) {
        const rect = scroller.getBoundingClientRect();
        if (cur.x >= rect.left && cur.x <= rect.right && cur.y >= rect.top && cur.y <= rect.bottom) {
          const edge = Math.min(48, rect.height / 3);
          const speed = cur.y < rect.top + edge ? -(rect.top + edge - cur.y) / edge
            : cur.y > rect.bottom - edge ? (cur.y - rect.bottom + edge) / edge : 0;
          scroller.scrollTop += speed * Math.min(32, lastFrame ? now - lastFrame : 16) * 0.6;
        }
      }
      lastFrame = now;
      updateTarget(cur);
      frame = window.requestAnimationFrame(scroll);
    };
    const onMove = (e: PointerEvent) => {
      const cur = session.current;
      if (!cur || e.pointerId !== cur.pointerId) return;
      if (e.buttons === 0) { cancel(); return; }
      cur.x = e.clientX;
      cur.y = e.clientY;
      if (!cur.active) {
        if (Math.hypot(cur.x - cur.startX, cur.y - cur.startY) < 6) return;
        cur.active = true;
        suppressClick.current = true;
        setDrag({ ...cur });
        frame = window.requestAnimationFrame(scroll);
      }
      updateTarget(cur);
      e.preventDefault();
    };
    const onUp = (e: PointerEvent) => {
      const cur = session.current;
      if (!cur || e.pointerId !== cur.pointerId) return;
      cur.x = e.clientX;
      cur.y = e.clientY;
      const element = atPoint(cur);
      reset();
      if (!cur.active) return;
      const store = useAppStore.getState();
      const t = translateRef.current;
      if (cur.kind === "folder") {
        const target = folderTarget(cur, element);
        if (target && element) {
          const rect = element.getBoundingClientRect();
          store.reorderChatFolder(cur.folderId, target.id, cur.y > rect.top + rect.height / 2);
        }
        return;
      }
      const id = element?.dataset.chatFolderDrop;
      const folder = store.settings.chatFolders?.find(f => f.id === id);
      const knownChats = new Set(store.chats.map(chat => chat.id));
      if (!id || (id !== "__ungrouped" && !folder) || cur.chatIds.some(id => !knownChats.has(id))) {
        store.pushToast(t("folder.dropMissed"), "info");
        return;
      }
      const next = id === "__ungrouped" ? null : id;
      const moved = cur.chatIds.filter(chatId => {
        const current = store.settings.chatFolders?.find(f => f.chatIds.includes(chatId));
        return (current?.id || null) !== next;
      });
      if (!moved.length) { store.pushToast(t("folder.dropUnchanged"), "info"); return; }
      moved.forEach(chatId => store.moveChatToFolder(chatId, next));
      store.pushToast(next ? t("folder.dropMoved", { name: folder!.name }) : t("folder.dropRemoved"), "success");
    };
    const onDown = (e: PointerEvent) => { if (e.isPrimary !== false) cancel(); };
    const onClick = (e: MouseEvent) => {
      if (!suppressClick.current || e.detail === 0) return;
      suppressClick.current = false;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cancel(); };
    const onPointerCancel = (e: PointerEvent) => { if (e.pointerId === session.current?.pointerId) cancel(); };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", onKey);
    window.addEventListener("click", onClick, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("click", onClick, true);
    };
  }, []);

  const start = (e: ReactPointerEvent, item: { kind: "chat"; chatId: string; chatIds: string[] } | { kind: "folder"; folderId: string }) => {
    if (e.button !== 0 || e.isPrimary === false) return;
    session.current = { ...item, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY,
      x: e.clientX, y: e.clientY, active: false,
      scroller: e.currentTarget.closest<HTMLElement>(".sidebar-chat-scroll") };
  };
  const targetName = chatFolders.find(f => f.id === dropTarget)?.name;
  return {
    dragChatId: drag?.kind === "chat" ? drag.chatId : null,
    dragFolderId: drag?.kind === "folder" ? drag.folderId : null,
    dropTarget,
    folderDropTarget,
    dragHint: drag?.kind === "chat" ? dropTarget === "__ungrouped" ? t("folder.moveOut")
      : targetName ? t("folder.dropInto", { name: targetName }) : t("folder.dragHelp") : null,
    startChatPointerDrag: (e: ReactPointerEvent, chatId: string, memberChatIds?: string[]) =>
      start(e, { kind: "chat", chatId, chatIds: [...new Set(memberChatIds?.length ? memberChatIds : [chatId])] }),
    startFolderPointerDrag: (e: ReactPointerEvent, folderId: string) => start(e, { kind: "folder", folderId }),
  };
}
