import { useCallback, useRef, useState, type DragEvent, type Dispatch, type SetStateAction } from "react";
import { moveByOffset, moveId } from "@/features/multiWindow/lib/reorder";
import type { SortMode } from "@/features/multiWindow/types";

export function useMultiWindowReorder({
  enabled,
  setOpenChatIds,
  setSortMode,
}: {
  enabled: boolean;
  setOpenChatIds: Dispatch<SetStateAction<string[]>>;
  setSortMode: Dispatch<SetStateAction<SortMode>>;
}) {
  const draggingIdRef = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const beginDrag = useCallback((id: string, event: DragEvent) => {
    if (!enabled) return;
    draggingIdRef.current = id;
    setDraggingId(id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  }, [enabled]);

  const dropOn = useCallback((targetId: string, event: DragEvent) => {
    event.preventDefault();
    const sourceId = draggingIdRef.current || event.dataTransfer.getData("text/plain");
    if (!enabled || !sourceId || sourceId === targetId) return;
    setOpenChatIds((current) => moveId(current, sourceId, targetId));
    setSortMode("opened");
  }, [enabled, setOpenChatIds, setSortMode]);

  const endDrag = useCallback(() => {
    draggingIdRef.current = null;
    setDraggingId(null);
  }, []);

  const moveByKeyboard = useCallback((id: string, offset: -1 | 1) => {
    if (!enabled) return;
    setOpenChatIds((current) => moveByOffset(current, id, offset));
    setSortMode("opened");
  }, [enabled, setOpenChatIds, setSortMode]);

  return { draggingId, beginDrag, dropOn, endDrag, moveByKeyboard };
}
