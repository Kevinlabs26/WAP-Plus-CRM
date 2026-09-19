import { Component, type ErrorInfo, type ReactNode } from "react";
import { useI18n } from "@/i18n";

type Props = {
  children: ReactNode;
  /** 可选的当前导航/视图描述，便于定位出错位置 */
  label?: string;
  /** 是否允许通过重试重新挂载子树（默认 true） */
  onRetry?: () => void;
};

type State = { error: Error | null };

function ErrorFallback({
  error,
  label,
  onRetry,
  onReset,
}: {
  error: Error;
  label?: string;
  onRetry: () => void;
  onReset: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex h-full min-h-[12rem] w-full flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-500/30 bg-rose-500/10">
        <svg viewBox="0 0 24 24" className="h-6 w-6 text-rose-300" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        </svg>
      </div>
      <div>
        <div className="text-[14px] font-semibold text-zinc-100">{t("error.page")}</div>
        <div className="mt-1 max-w-sm text-[12px] leading-5 text-zinc-500">
          {label ? `「${label}」` : t("error.area")} {t("error.failed")}
        </div>
        {error.message && <div className="mx-auto mt-2 max-w-sm truncate rounded-md bg-zinc-900 px-2.5 py-1 font-mono text-[11px] text-zinc-500">{error.message}</div>}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onRetry} className="ui-btn-secondary !min-h-9 px-3.5">{t("error.retry")}</button>
        <button type="button" onClick={onReset} className="ui-btn-ghost !min-h-9 text-zinc-400">{t("error.collapse")}</button>
      </div>
    </div>
  );
}

/**
 * 页面级错误边界：某个视图/面板运行时抛错时，
 * 只降级该区域，避免整个应用白屏；可重试与「回工作台」。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 保留到控制台以便排查（不打断用户）
    console.error("[ErrorBoundary]", this.props.label || "view", error);
    console.error("[ErrorBoundary] component stack", info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;

    return <ErrorFallback error={this.state.error} label={this.props.label} onRetry={this.reset} onReset={() => { this.reset(); this.props.onRetry?.(); }} />;
  }
}
