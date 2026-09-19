import { cn } from "@/lib/utils";

export function Ticks({
  kind,
  onImage,
}: {
  kind: "sent" | "delivered" | "read";
  onImage?: boolean;
}) {
  // ✓ 已发送 · ✓✓ 送达 · 蓝色 ✓✓ 已读
  const color =
    kind === "read"
      ? "text-sky-600 dark:text-sky-400 font-bold"
      : onImage
        ? "text-white/90"
        : "text-zinc-600 dark:text-zinc-400";
  const double = kind === "delivered" || kind === "read";
  return (
    <span
      className={cn("inline-flex items-center text-[11px] leading-none", color)}
      title={
        kind === "read" ? "已读" : kind === "delivered" ? "已送达" : "已发送"
      }
    >
      {double ? "✓✓" : "✓"}
    </span>
  );
}

