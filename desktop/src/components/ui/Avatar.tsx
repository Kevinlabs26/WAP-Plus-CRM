import { useState } from "react";
import { Bookmark, Users } from "lucide-react";
import { avatarColorClass, avatarInitials, cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

type Props = {
  name?: string | null;
  seed?: string | null;
  /** 真实头像 URL；失败或空则回退首字母 */
  src?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
  variant?: "default" | "saved" | "accounts";
  /** 右下角在线绿点（WhatsApp presence available） */
  online?: boolean;
  onlineTitle?: string;
};

const SIZE = {
  sm: "h-7 w-7 text-2xs",
  md: "h-8 w-8 text-[11px]",
  lg: "h-10 w-10 text-[13px]",
} as const;

const DOT = {
  sm: "h-2 w-2 bottom-0 right-0",
  md: "h-2.5 w-2.5 bottom-0 right-0",
  lg: "h-3 w-3 bottom-0.5 right-0.5",
} as const;

/** 头像：优先真实图，否则彩色首字母（src 变化时重置失败态） */
export function Avatar({
  name,
  seed,
  src,
  size = "md",
  className,
  variant = "default",
  online,
  onlineTitle,
}: Props) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const { t } = useI18n();
  const label = avatarInitials(name);
  const color = avatarColorClass(seed || name || label);
  const showImg = Boolean(src) && src !== failedSrc;

  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold tracking-tight",
        SIZE[size],
        className
      )}
    >
      <span
        className={cn(
          "flex h-full w-full items-center justify-center overflow-hidden rounded-full ring-1 ring-black/20",
          showImg
            ? "bg-zinc-100 dark:bg-zinc-800"
            : variant === "saved"
              ? "!bg-emerald-500/15 !text-emerald-700 dark:!bg-brand/20 dark:!text-brand ring-emerald-500/20"
              : variant === "accounts"
                ? "bg-zinc-800 text-zinc-300"
              : color
        )}
      >
        {showImg ? (
          <img
            src={src!}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            decoding="async"
            draggable={false}
            referrerPolicy="no-referrer"
            onError={() => setFailedSrc(src || null)}
          />
        ) : variant === "saved" ? (
          <Bookmark className="h-4 w-4 shrink-0 fill-emerald-600 text-emerald-600 dark:fill-brand dark:text-brand" strokeWidth={1.8} />
        ) : variant === "accounts" ? (
          <Users className="h-4 w-4" strokeWidth={2.2} />
        ) : (
          label
        )}
      </span>
      {online && (
        <span
          title={onlineTitle || t("tooltip.online")}
          className={cn(
            "absolute z-[1] rounded-full bg-emerald-500 ring-2 ring-zinc-950",
            DOT[size]
          )}
        />
      )}
    </span>
  );
}
