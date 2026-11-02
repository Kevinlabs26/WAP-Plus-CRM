import { useEffect, useRef } from "react";

// Native details menus do not dismiss themselves on outside interaction.
export function useDetailsMenu(contextKey?: string) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const close = () => { menu.open = false; };
    const outside = (event: Event) => {
      if (menu.open && event.target instanceof Node && !menu.contains(event.target)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (!menu.open || event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation(); close();
      menu.querySelector("summary")?.focus();
    };
    close();
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside, true);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("blur", close);
    return () => {
      close();
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside, true);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("blur", close);
    };
  }, [contextKey]);
  return ref;
}
