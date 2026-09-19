import { useEffect, type MutableRefObject, type SetStateAction } from "react";

export function useMultiWindowShortcuts({
  visibleIds,
  page,
  totalPages,
  setPage,
  cardRefs,
}: {
  visibleIds: string[];
  page: number;
  totalPages: number;
  setPage: (value: SetStateAction<number>) => void;
  cardRefs: MutableRefObject<Record<string, HTMLElement | null>>;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;

      if (event.key === "ArrowLeft" && page > 0) {
        event.preventDefault();
        setPage((current) => Math.max(0, current - 1));
        return;
      }
      if (event.key === "ArrowRight" && page < totalPages - 1) {
        event.preventDefault();
        setPage((current) => Math.min(totalPages - 1, current + 1));
        return;
      }
      if (!/^[1-9]$/.test(event.key)) return;
      const windowId = visibleIds[Number(event.key) - 1];
      const card = windowId ? cardRefs.current[windowId] : null;
      if (!card) return;
      event.preventDefault();
      card.scrollIntoView({ block: "nearest", behavior: "smooth" });
      const textarea = card.querySelector("textarea");
      if (textarea instanceof HTMLTextAreaElement) textarea.focus();
      else card.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cardRefs, page, setPage, totalPages, visibleIds]);
}
