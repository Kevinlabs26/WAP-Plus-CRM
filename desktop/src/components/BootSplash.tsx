import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { WapPlusMark } from "@/components/brand/WapPlusMark";
import { useI18n } from "@/i18n";

type Props = {
  /** 0–100，由外层按真实阶段驱动 */
  progress: number;
  /** 阶段文案 */
  label?: string;
  /** 即将切主界面时的淡出 */
  exiting?: boolean;
};

/**
 * 启动闪屏（参考 WA 结构，深色品牌化）：
 * Logo + 进度条 + 安全提示。进度由 hydrate / 暖机真实阶段驱动，避免假进度过早进房。
 */
export function BootSplash({
  progress,
  label,
  exiting = false,
}: Props) {
  const { t } = useI18n();
  const loadingLabel = label || t("boot.loading");
  const p = Math.max(0, Math.min(100, progress));
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = window.requestAnimationFrame(() => setVisible(true));
    return () => window.cancelAnimationFrame(t);
  }, []);

  return (
    <div
      className={
        "pointer-events-none fixed inset-0 z-[200] flex flex-col items-center justify-center overflow-hidden bg-zinc-950 transition-opacity duration-500 ease-out " +
        (exiting || !visible ? "opacity-0" : "opacity-100")
      }
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(p)}
      aria-label={loadingLabel}
    >
      {/* 氛围光 */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 55% at 50% 42%, rgba(37,211,102,0.14), transparent 62%), radial-gradient(ellipse 60% 40% at 50% 100%, rgba(37,211,102,0.06), transparent 55%)",
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.04),transparent_45%)]" />

      <div className="relative flex w-full max-w-sm flex-col items-center px-8">
        {/* Logo */}
        <div className="relative mb-7">
          <div className="absolute -inset-6 animate-pulse rounded-full bg-brand/10 blur-2xl" />
          <WapPlusMark
            sizeClassName="relative h-[4.5rem] w-[4.5rem] rounded-[1.35rem] shadow-[0_12px_40px_-8px_rgba(37,211,102,0.55)] ring-1 ring-white/10"
            className="bg-gradient-to-br from-brand via-brand to-emerald-700"
          />
          {/* 细环转动感 */}
          <div
            className="pointer-events-none absolute -inset-3 rounded-full border border-brand/20"
            style={{
              maskImage:
                "conic-gradient(from 0deg, transparent 0%, black 30%, transparent 55%)",
              WebkitMaskImage:
                "conic-gradient(from 0deg, transparent 0%, black 30%, transparent 55%)",
              animation: "wap-boot-spin 2.8s linear infinite",
            }}
          />
        </div>

        <div className="mb-1 text-[22px] font-semibold tracking-tight text-zinc-50">
          Bridge<span className="text-brand">CRM</span>
        </div>
        <div className="mb-8 text-[12px] tracking-wide text-zinc-500">
          {t("boot.subtitle")}
        </div>

        {/* 进度轨 */}
        <div className="mb-3 h-[3px] w-[min(220px,70vw)] overflow-hidden rounded-full bg-zinc-800/90">
          <div
            className="relative h-full rounded-full bg-gradient-to-r from-emerald-600 via-brand to-emerald-300 transition-[width] duration-300 ease-out"
            style={{ width: `${p}%` }}
          >
            <div className="absolute inset-0 animate-pulse bg-white/20" />
          </div>
        </div>

        <div className="min-h-[1.25rem] text-center text-[11px] text-zinc-500">
          {loadingLabel}
        </div>

        <div className="mt-10 flex items-center gap-1.5 text-[11px] text-zinc-600">
          <Lock className="h-3 w-3 shrink-0" strokeWidth={2} />
          <span>{t("boot.localStorage")}</span>
        </div>
      </div>

      <style>{`
        @keyframes wap-boot-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
