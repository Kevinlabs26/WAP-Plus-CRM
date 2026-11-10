import { useEffect, useRef, useState } from "react";
export type LibraryDrag = {
    kind: "image" | "category";
    id: string;
};
export type LibraryDrop = {
    category: string;
    imageId?: string;
    after: boolean;
};
export function libraryDropAt(root: HTMLElement, x: number, y: number, source: LibraryDrag): LibraryDrop | null {
    const element = document.elementFromPoint(x, y);
    if (!element || !root.contains(element))
        return null;
    const image = element.closest<HTMLElement>("[data-library-image]");
    const category = element.closest<HTMLElement>("[data-library-category]");
    if (!category)
        return null;
    const name = category.dataset.libraryCategory!;
    if (source.kind === "category") {
        if (!name || source.id === name)
            return null;
        const rect = category.getBoundingClientRect();
        return { category: name, after: y >= rect.top + rect.height / 2 };
    }
    if (image) {
        if (image.dataset.libraryImage === source.id)
            return null;
        const rect = image.getBoundingClientRect();
        return { category: name, imageId: image.dataset.libraryImage, after: y > rect.bottom - rect.height / 4 || x >= rect.left + rect.width / 2 };
    }
    return { category: name, after: true };
}
export function useImageLibraryDrag(contextKey: string, onDrop: (source: LibraryDrag, target: LibraryDrop) => void) {
    const root = useRef<HTMLElement>(null), scroller = useRef<HTMLElement | null>(null), callback = useRef(onDrop);
    callback.current = onDrop;
    const current = useRef<(LibraryDrag & {
        pointerId: number;
        x: number;
        y: number;
        startX: number;
        startY: number;
        active: boolean;
    }) | null>(null);
    const suppress = useRef(false), frame = useRef<number | undefined>(undefined), [target, setTarget] = useState<LibraryDrop | null>(null), [active, setActive] = useState(false);
    const previous = useRef("");
    const cancel = () => { if (current.current?.active)
        suppress.current = true; if (frame.current !== undefined)
        cancelAnimationFrame(frame.current); frame.current = undefined; current.current = null; previous.current = ""; setTarget(null); setActive(false); };
    useEffect(() => { const stop = () => cancel(), escape = (event: KeyboardEvent) => { if (event.key === "Escape")
        stop(); }; window.addEventListener("blur", stop); window.addEventListener("keydown", escape); return () => { stop(); window.removeEventListener("blur", stop); window.removeEventListener("keydown", escape); }; }, [contextKey]);
    const tick = () => {
        const drag = current.current;
        if (!drag?.active || !root.current)
            return;
        const scroll = scroller.current;
        if (scroll) {
            const rect = scroll.getBoundingClientRect();
            if (drag.y < rect.top + 36)
                scroll.scrollTop -= 14;
            else if (drag.y > rect.bottom - 36)
                scroll.scrollTop += 14;
        }
        const next = libraryDropAt(root.current, drag.x, drag.y, drag), key = JSON.stringify(next);
        if (key !== previous.current) {
            previous.current = key;
            setTarget(next);
        }
        frame.current = requestAnimationFrame(tick);
    };
    const handle = (source: LibraryDrag) => ({
        onPointerDown: (event: React.PointerEvent<HTMLElement>) => { if (event.button !== 0 || event.isPrimary === false)
            return; suppress.current = false; current.current = { ...source, pointerId: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, active: false }; },
    });
    return { root, scroller, target, active, handle, events: {
            onPointerMove: (event: React.PointerEvent<HTMLElement>) => { const drag = current.current; if (!drag || drag.pointerId !== event.pointerId)
                return; drag.x = event.clientX; drag.y = event.clientY; if (!drag.active) {
                if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 6)
                    return;
                drag.active = true;
                root.current?.setPointerCapture(event.pointerId);
                setActive(true);
                tick();
            } event.preventDefault(); },
            onPointerUp: (event: React.PointerEvent<HTMLElement>) => { const drag = current.current; if (!drag || drag.pointerId !== event.pointerId)
                return; const drop = drag.active && root.current ? libraryDropAt(root.current, event.clientX, event.clientY, drag) : null; if (drag.active)
                suppress.current = true; cancel(); if (root.current?.hasPointerCapture(event.pointerId))
                root.current.releasePointerCapture(event.pointerId); if (drop)
                callback.current(drag, drop); },
            onPointerCancel: () => cancel(), onLostPointerCapture: () => cancel(),
            onClickCapture: (event: React.MouseEvent<HTMLElement>) => { if (suppress.current) {
                suppress.current = false;
                event.preventDefault();
                event.stopPropagation();
            } },
        } };
}
