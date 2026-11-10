import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import React, {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "md" | "sm" | "xs";
}) {
  return (
    <button
      type="button"
      className={cn(
        variant === "primary" && "ui-btn-primary",
        variant === "secondary" && "ui-btn-secondary",
        variant === "ghost" && "ui-btn-ghost",
        size === "sm" && "min-h-8 px-2.5 text-[13px]",
        size === "xs" && "min-h-7 px-2 text-2xs",
        className
      )}
      {...props}
    />
  );
}

export const Input = React.forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
    size?: "md" | "sm";
  }
>(function Input({ className, size = "md", ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "ui-control w-full px-2.5 text-[14px]",
        size === "sm" && "min-h-8 !px-2 text-[13px]",
        className
      )}
      {...props}
    />
  );
});

export function Switch(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className" | "role">) {
  return <span className="relative inline-flex shrink-0">
    <input {...props} type="checkbox" role="switch" className="peer sr-only" />
    <span aria-hidden="true" className="h-6 w-11 cursor-pointer rounded-full bg-zinc-600 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-brand peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-2 peer-disabled:cursor-not-allowed peer-disabled:opacity-50" />
  </span>;
}

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "ui-control w-full resize-none px-2.5 py-2 text-[14px]",
        className
      )}
      {...props}
    />
  );
});

export function Badge({
  children,
  tone = "muted",
  className,
}: {
  children: ReactNode;
  tone?: "muted" | "brand";
  className?: string;
}) {
  return (
    <span
      className={cn(
        tone === "brand" ? "ui-badge-brand" : "ui-badge-muted",
        className
      )}
    >
      {children}
    </span>
  );
}

export function SectionLabel({
  children,
  className,
  action,
}: {
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <div className={cn("mb-2 flex items-center justify-between gap-2", className)}>
      <h4 className="ui-section-label">{children}</h4>
      {action}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="ui-empty">
      <div className="text-[16px] font-semibold text-zinc-200">{title}</div>
      {description && (
        <p className="max-w-md text-[13px] leading-relaxed text-zinc-500">
          {description}
        </p>
      )}
      {action}
    </div>
  );
}

export function Panel({
  children,
  className,
  width,
}: {
  children: ReactNode;
  className?: string;
  width?: string;
}) {
  return (
    <aside
      className={cn("ui-panel flex shrink-0 flex-col", width, className)}
      style={width ? undefined : undefined}
    >
      {children}
    </aside>
  );
}

export function ListRow({
  active,
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "ui-row",
        active ? "ui-row-active" : "ui-row-idle",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function OnlineDot({ online }: { online: boolean }) {
  const { t } = useI18n();
  return (
    <span
      className={cn(
        "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
        online ? "bg-brand" : "bg-zinc-600"
      )}
      title={online ? t("tooltip.online") : t("tooltip.offline")}
    />
  );
}
