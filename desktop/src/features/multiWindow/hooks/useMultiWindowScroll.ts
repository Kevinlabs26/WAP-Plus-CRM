import { useLayoutEffect, useRef, useState } from "react";
import type { Message } from "@/types/crm";

export function useMultiWindowScroll(messages: Message[], collapsed: boolean) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const previous = useRef<{ first?: string; last?: string; height: number } | null>(null);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const scrollToLatest = () => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
    following.current = true;
    setAwayFromBottom(false);
  };
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) { previous.current = null; return; }
    const first = messages[0]?.id, last = messages.at(-1)?.id;
    const old = previous.current;
    if (old && !following.current && old.first !== first && old.last === last) {
      node.scrollTop += node.scrollHeight - old.height;
    } else if (!old || following.current) {
      scrollToLatest();
    }
    previous.current = { first, last, height: node.scrollHeight };
  }, [messages, collapsed]);
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    // Media and grid layout can settle after the messages have rendered.
    const follow = () => { if (following.current) scrollToLatest(); };
    const frame = requestAnimationFrame(follow);
    const observer = new ResizeObserver(follow);
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [collapsed]);
  return { scrollRef, awayFromBottom, scrollToLatest,
    onScroll: () => {
      const node = scrollRef.current;
      if (!node) return;
      following.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
      setAwayFromBottom(!following.current);
    },
    onMediaLoad: () => { if (following.current) scrollToLatest(); },
  };
}
