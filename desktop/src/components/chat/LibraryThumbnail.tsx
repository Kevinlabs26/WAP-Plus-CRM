import { useEffect, useRef, useState } from "react";
import { readLibraryThumbnail, type LibraryImage } from "@/lib/imageLibrary";

export function LibraryThumbnail({ image, alt, className, placeholderClassName = "h-20 w-16 max-w-full rounded-md" }: { image: LibraryImage; alt: string; className: string; placeholderClassName?: string }) {
  const placeholder = useRef<HTMLSpanElement>(null);
  const [loaded, setLoaded] = useState<{ id: string; url: string }>();
  const url = image.thumbnail || (loaded?.id === image.id ? loaded.url : "");

  useEffect(() => {
    const node = placeholder.current;
    if (url || !node) return;
    let active = true;
    const load = () => {
      void readLibraryThumbnail(image.id).then(src => { if (active) setLoaded({ id: image.id, url: src }); }).catch(() => {});
    };
    const observer = typeof IntersectionObserver === "undefined" ? undefined : new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer?.disconnect();
      load();
    }, { rootMargin: "120px" });
    if (observer) observer.observe(node); else load();
    return () => { active = false; observer?.disconnect(); };
  }, [image.id, url]);

  return url ? <img src={url} alt={alt} draggable={false} decoding="async" className={className} />
    : <span ref={placeholder} aria-hidden="true" className={`block bg-zinc-800/50 ${placeholderClassName}`} />;
}
