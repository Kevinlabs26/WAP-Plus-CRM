import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/store/appStore";
import { useShallow } from "zustand/react/shallow";
import type { ChatFolder } from "@/store/appStore";
import type { PointerEvent as ReactPointerEvent } from "react";

export type ChatPointerDragState = {
  chatId: string;
  x: number;
  y: number;
  active: boolean;
};

type UseChatFolderDragArgs = {
  chatFolders: ChatFolder[];
  primaryFolderIdOf: (chatId: string) => string | null;
};

/**
 * 侧栏会话/文件夹拖放：HTML5 DnD 在 WebView 里 dataTransfer.types
 * 常为空导致 drop 被拦（禁止图标），改用 pointer 自实现，鼠标/触控都稳定。
 */
export function useChatFolderDrag({
  chatFolders,
  primaryFolderIdOf,
}: UseChatFolderDragArgs) {
  const { moveChatToFolder, reorderChatFolder, pushToast } = useAppStore(
    useShallow((s) => ({
      moveChatToFolder: s.moveChatToFolder,
      reorderChatFolder: s.reorderChatFolder,
      pushToast: s.pushToast,
    }))
  );

  const [dragChatId, setDragChatId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dragFolderId, setDragFolderId] = useState<string | null>(null);
  const [folderDropTarget, setFolderDropTarget] = useState<string | null>(null);

  const folderDragRef = useRef<{
    folderId: string;
    x: number;
    y: number;
    active: boolean;
  } | null>(null);

  const pointerDragRef = useRef<ChatPointerDragState | null>(null);
  const [pointerDrag, setPointerDrag] = useState<ChatPointerDragState | null>(
    null
  );
  pointerDragRef.current = pointerDrag;

  const folderRowRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  const folderAtPoint = (x: number, y: number): string | null => {
    for (const [id, el] of folderRowRefs.current) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return id;
    }
    return null;
  };

  useEffect(() => {
    if (!pointerDrag) return;
    const onMove = (e: PointerEvent) => {
      const cur = pointerDragRef.current;
      if (!cur) return;
      const dx = e.clientX - cur.x;
      const dy = e.clientY - cur.y;
      if (!cur.active && Math.hypot(dx, dy) < 6) return;
      if (!cur.active) {
        const activeDrag = { ...cur, active: true };
        pointerDragRef.current = activeDrag;
        setPointerDrag(activeDrag);
        setDragChatId(cur.chatId);
      }
      const target = folderAtPoint(e.clientX, e.clientY);
      setDropTarget(target);
      e.preventDefault();
    };
    const onUp = (e: PointerEvent) => {
      const cur = pointerDragRef.current;
      if (!cur) return;
      pointerDragRef.current = null;
      setPointerDrag(null);
      setDropTarget(null);
      setDragChatId(null);
      if (!cur.active) return;
      const target = folderAtPoint(e.clientX, e.clientY);
      if (target) {
        const current = primaryFolderIdOf(cur.chatId);
        const next = target === "__ungrouped" ? null : target;
        if ((current || null) !== next) {
          moveChatToFolder(cur.chatId, next);
          if (next) {
            const name = chatFolders.find((f) => f.id === next)?.name || "分组";
            pushToast(`已移动到「${name}」`, "success");
          } else {
            pushToast("已移出分组", "info");
          }
        }
      }
    };
    const cancel = () => {
      pointerDragRef.current = null;
      setPointerDrag(null);
      setDropTarget(null);
      setDragChatId(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointerDrag]);

  const startChatPointerDrag = (e: ReactPointerEvent, chatId: string) => {
    if (e.button !== 0) return;
    const pending = { chatId, x: e.clientX, y: e.clientY, active: false };
    pointerDragRef.current = pending;
    setPointerDrag(pending);
  };

  const startFolderPointerDrag = (
    e: ReactPointerEvent,
    folderId: string
  ) => {
    if (e.button !== 0) return;
    folderDragRef.current = {
      folderId,
      x: e.clientX,
      y: e.clientY,
      active: false,
    };
    setDragFolderId(folderId);
  };

  useEffect(() => {
    if (!dragFolderId) return;
    const onMove = (e: PointerEvent) => {
      const cur = folderDragRef.current;
      if (!cur) return;
      if (
        !cur.active &&
        Math.hypot(e.clientX - cur.x, e.clientY - cur.y) < 6
      )
        return;
      cur.active = true;
      const target = folderAtPoint(e.clientX, e.clientY);
      const source = chatFolders.find((f) => f.id === cur.folderId);
      const targetFolder = target
        ? chatFolders.find((f) => f.id === target)
        : undefined;
      setFolderDropTarget(
        source &&
          targetFolder &&
          source.id !== targetFolder.id &&
          source.parentId === targetFolder.parentId
          ? targetFolder.id
          : null
      );
      e.preventDefault();
    };
    const onUp = (e: PointerEvent) => {
      const cur = folderDragRef.current;
      folderDragRef.current = null;
      setDragFolderId(null);
      setFolderDropTarget(null);
      if (!cur?.active) return;
      const target = folderAtPoint(e.clientX, e.clientY);
      const source = chatFolders.find((f) => f.id === cur.folderId);
      const targetFolder = target
        ? chatFolders.find((f) => f.id === target)
        : undefined;
      if (
        source &&
        targetFolder &&
        source.id !== targetFolder.id &&
        source.parentId === targetFolder.parentId
      ) {
        const rect = folderRowRefs.current
          .get(targetFolder.id)
          ?.getBoundingClientRect();
        reorderChatFolder(
          cur.folderId,
          targetFolder.id,
          !!rect && e.clientY > rect.top + rect.height / 2
        );
      }
    };
    const cancel = () => {
      folderDragRef.current = null;
      setDragFolderId(null);
      setFolderDropTarget(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", onKey);
    };
  }, [chatFolders, dragFolderId, reorderChatFolder]);

  return {
    dragChatId,
    dropTarget,
    dragFolderId,
    folderDropTarget,
    folderRowRefs,
    startChatPointerDrag,
    startFolderPointerDrag,
  };
}
