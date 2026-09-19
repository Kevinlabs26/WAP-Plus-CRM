import { cn } from "@/lib/utils";
import iconUrl from "@/assets/wap-plus-crm-trimmed.svg";

type Props = {
  className?: string;
  /** 外框尺寸 class，默认顶部 h-7 w-7 */
  sizeClassName?: string;
  title?: string;
};

/**
 * WAP Plus CRM 品牌标：用户提供的 W 会话图形 + Plus。 */
export function WapPlusMark({
  className,
  sizeClassName = "h-7 w-7",
  title = "WAP Plus CRM",
}: Props) {
  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      className={cn(
        "inline-flex shrink-0 overflow-hidden rounded-lg shadow-sm shadow-brand/20 ring-1 ring-black/10",
        sizeClassName,
        className
      )}
    >
      <img src={iconUrl} alt="" aria-hidden className="h-full w-full" />
    </span>
  );
}
