import { useId, useLayoutEffect, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { useI18n } from "@/i18n";

type Action = { label: string; onSelect: () => void; disabled?: boolean; destructive?: boolean };

export function MultiWindowCardMenu({ title, actions }: { title: string; actions: Action[] }) {
  const { t } = useI18n();
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ right: number; top: number; bottom: number; last: boolean } | null>(null);
  const close = (restoreFocus = true) => {
    setAnchor(null);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  };
  const open = (last = false) => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ right: rect.right, top: rect.top, bottom: rect.bottom, last });
  };

  useLayoutEffect(() => {
    if (!anchor || !menuRef.current) return;
    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    // A portal keeps menus usable inside collapsed and overflow-hidden cards.
    menu.style.left = `${Math.max(8, Math.min(anchor.right - rect.width, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${anchor.bottom + rect.height + 4 <= window.innerHeight - 8
      ? anchor.bottom + 4 : Math.max(8, anchor.top - rect.height - 4)}px`;
  }, [anchor, actions.length]);
  useLayoutEffect(() => {
    if (!anchor) return;
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
    items?.[anchor.last ? items.length - 1 : 0]?.focus();
  }, [anchor]);
  useEffect(() => {
    if (!anchor) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) close(false);
    };
    const scroll = (event: Event) => {
      if (!(event.target instanceof Node) || !menuRef.current?.contains(event.target)) close(false);
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("focusin", outside, true);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", scroll);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("focusin", outside, true);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", scroll);
    };
  }, [anchor]);

  return <>
    <button ref={triggerRef} type="button" aria-haspopup="menu" aria-expanded={!!anchor} aria-controls={anchor ? id : undefined}
      aria-label={t("multi.windowMenuFor", { name: title })} title={t("multi.windowMenu")}
      className="shrink-0 rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      onClick={() => anchor ? close() : open()}
      onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          open(event.key === "ArrowUp");
        }
      }}><MoreHorizontal className="h-4 w-4" /></button>
    {anchor && createPortal(<div ref={menuRef} id={id} role="menu" aria-label={t("multi.windowMenuFor", { name: title })}
      className="fixed z-[9999] max-h-[calc(100vh_-_1rem)] w-52 max-w-[calc(100vw_-_1rem)] overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 py-1 shadow-xl shadow-black/40"
      style={{ left: anchor.right - 208, top: anchor.bottom + 4 }}
      onKeyDown={event => {
        if (event.key === "Escape" || event.key === "Tab") {
          if (event.key === "Escape") event.preventDefault();
          event.stopPropagation();
          close();
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }}>
      {actions.map(action => <button key={action.label} type="button" role="menuitem" tabIndex={-1} disabled={action.disabled}
        className={`block w-full px-3 py-2 text-left text-xs outline-none hover:bg-zinc-800 focus:bg-zinc-800 disabled:opacity-40 ${action.destructive ? "text-rose-400" : "text-zinc-200"}`}
        onClick={() => { close(); action.onSelect(); }}>{action.label}</button>)}
    </div>, document.body)}
  </>;
}
