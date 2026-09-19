import { useRef, useState } from "react";
import { Check, Image as ImageIcon, Moon, Sun, X } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { getLocaleOptions, normalizeLocale, useI18n, type TranslationKey } from "@/i18n";
import { SectionLabel, Button } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import {
  CHAT_PATTERNS,
  buildPatternBackground,
  type ChatPatternId,
} from "@/lib/chatPatterns";

const PRESET_COLORS: { nameKey: "appearance.colorGraphite" | "appearance.colorInkBlue" | "appearance.colorForest" | "appearance.colorWine" | "appearance.colorWarmBrown" | "appearance.colorNightSky"; color: string }[] = [
  { nameKey: "appearance.colorGraphite", color: "#18181b" },
  { nameKey: "appearance.colorInkBlue", color: "#0f172a" },
  { nameKey: "appearance.colorForest", color: "#123524" },
  { nameKey: "appearance.colorWine", color: "#2b1a22" },
  { nameKey: "appearance.colorWarmBrown", color: "#2b2416" },
  { nameKey: "appearance.colorNightSky", color: "#131c2e" },
];

const PATTERN_NAME_KEYS: Record<ChatPatternId, TranslationKey> = {
  dots: "appearance.patternDots",
  polka: "appearance.patternPolka",
  diagonal: "appearance.patternDiagonal",
  crosshatch: "appearance.patternCrosshatch",
  waves: "appearance.patternWaves",
  hexagons: "appearance.patternHexagons",
  plus: "appearance.patternPlus",
  zigzag: "appearance.patternZigzag",
};

/** 降采样为 JPEG data URL，控制体积以便随设置持久化 */
function fileToBackgroundDataUrl(
  file: File,
  maxDim = 1280,
  quality = 0.82,
  t?: (key: TranslationKey) => string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error(t?.("appearance.canvasUnavailable") || "Image processing is unavailable"));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch (e) {
        reject(e instanceof Error ? e : new Error(t?.("appearance.imageProcessError") || "Image processing failed"));
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(t?.("appearance.imageReadError") || "Unable to read the image"));
    };
    img.src = url;
  });
}

export function SettingsAppearancePanel() {
  const { t } = useI18n();
  const theme = useAppStore((s) => s.settings.theme);
  const uiLanguage = useAppStore((s) => s.settings.uiLanguage);
  const chatBackground = useAppStore((s) => s.settings.chatBackground);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const pushToast = useAppStore((s) => s.pushToast);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  const applyColor = (color: string) =>
    updateSettings({ chatBackground: { kind: "color", color } });

  const applyPattern = (patternId: ChatPatternId) =>
    updateSettings({ chatBackground: { kind: "pattern", patternId } });

  const clearBackground = () => updateSettings({ chatBackground: { kind: "none" } });

  const pickImage = async (files: FileList | null | undefined) => {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const imageUrl = await fileToBackgroundDataUrl(file, 1280, 0.82, t);
      updateSettings({ chatBackground: { kind: "image", imageUrl } });
      pushToast(t("appearance.chatBackgroundUpdated"), "success");
    } catch (e) {
      pushToast(e instanceof Error ? e.message : t("appearance.imageProcessError"), "error");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const active =
    chatBackground?.kind === "image"
      ? t("appearance.image")
      : chatBackground?.kind === "pattern"
        ? (chatBackground.patternId && PATTERN_NAME_KEYS[chatBackground.patternId as ChatPatternId]
            ? t(PATTERN_NAME_KEYS[chatBackground.patternId as ChatPatternId])
            : undefined) ||
          t("appearance.pattern")
        : chatBackground?.kind === "color"
          ? chatBackground.color || t("appearance.color")
          : t("appearance.default");

  return (
    <div className="mx-auto min-w-0 max-w-3xl space-y-6">
      <header>
        <h3 className="text-lg font-semibold text-zinc-100">{t("appearance.title")}</h3>
        <p className="mt-1 break-words text-[11px] text-zinc-500">{t("appearance.description")}</p>
      </header>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <SectionLabel className="!mb-0">{t("appearance.language")}</SectionLabel>
            <p className="mt-1 max-w-xl break-words text-2xs text-zinc-600">{t("appearance.languageHint")}</p>
          </div>
          <select
            className="ui-control max-w-full shrink-0"
            value={uiLanguage}
            aria-label={t("appearance.language")}
            onChange={(event) => updateSettings({ uiLanguage: normalizeLocale(event.target.value) })}
          >
            {getLocaleOptions().map((option) => (
              <option key={option.code} value={option.code}>{option.label}</option>
            ))}
          </select>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
        <SectionLabel>{t("appearance.theme")}</SectionLabel>
        <div className="mt-3 grid grid-cols-2 gap-3.5">
          <button
            type="button"
            onClick={() => updateSettings({ theme: "dark" })}
            className={cn(
              "group relative flex flex-col items-stretch gap-3 rounded-xl border p-3.5 text-left transition-all",
              theme === "dark"
                ? "border-brand/70 bg-zinc-900/90 ring-2 ring-brand/20 shadow-md"
                : "border-zinc-800 bg-zinc-900/30 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900/60"
            )}
          >
            {/* 深色微缩界面模型 */}
            <div className="relative flex h-20 w-full flex-col overflow-hidden rounded-lg border border-zinc-800/80 bg-[#090a0b] p-2 shadow-inner">
              <div className="flex h-3 w-full items-center gap-1 border-b border-zinc-800/80 pb-1.5">
                <div className="h-1.5 w-1.5 rounded-full bg-rose-500/80" />
                <div className="h-1.5 w-1.5 rounded-full bg-amber-500/80" />
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500/80" />
              </div>
              <div className="flex flex-1 items-center justify-between px-1 pt-1.5">
                <div className="flex flex-col gap-1 w-20">
                  <div className="h-2 w-14 rounded-full bg-zinc-800" />
                  <div className="h-1.5 w-10 rounded-full bg-zinc-800/60" />
                </div>
                <div className="flex flex-col gap-1 items-end">
                  <div className="h-2.5 w-14 rounded-lg bg-emerald-950/90 border border-emerald-500/30" />
                  <div className="h-2.5 w-10 rounded-lg bg-emerald-950/90 border border-emerald-500/30" />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Moon className="h-4 w-4 text-brand" />
                <div className="min-w-0">
                  <div className="break-words text-[13px] font-semibold text-zinc-100">{t("appearance.dark")}</div>
                  <div className="break-words text-2xs text-zinc-500">{t("appearance.darkDesc")}</div>
                </div>
              </div>
              {theme === "dark" && (
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-brand text-brand-foreground shadow-sm">
                  <Check className="h-3 w-3 stroke-[3]" />
                </div>
              )}
            </div>
          </button>

          <button
            type="button"
            onClick={() => updateSettings({ theme: "light" })}
            className={cn(
              "group relative flex flex-col items-stretch gap-3 rounded-xl border p-3.5 text-left transition-all",
              theme === "light"
                ? "border-brand/70 bg-zinc-900/90 ring-2 ring-brand/20 shadow-md"
                : "border-zinc-800 bg-zinc-900/30 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900/60"
            )}
          >
            {/* 浅色微缩界面模型 */}
            <div className="relative flex h-20 w-full flex-col overflow-hidden rounded-lg border border-slate-200/80 bg-[#efeae2] p-2 shadow-inner">
              <div className="flex h-3 w-full items-center gap-1 border-b border-slate-200/80 pb-1.5">
                <div className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                <div className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              </div>
              <div className="flex flex-1 items-center justify-between px-1 pt-1.5">
                <div className="flex flex-col gap-1 w-20">
                  <div className="h-2 w-14 rounded-full bg-slate-300" />
                  <div className="h-1.5 w-10 rounded-full bg-slate-300/60" />
                </div>
                <div className="flex flex-col gap-1 items-end">
                  <div className="h-2.5 w-14 rounded-lg bg-[#d9fdd3] border border-[#c4ebc0] shadow-xs" />
                  <div className="h-2.5 w-10 rounded-lg bg-[#d9fdd3] border border-[#c4ebc0] shadow-xs" />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sun className="h-4 w-4 text-amber-500" />
                <div className="min-w-0">
                  <div className="break-words text-[13px] font-semibold text-zinc-100">{t("appearance.light")}</div>
                  <div className="break-words text-2xs text-zinc-500">{t("appearance.lightDesc")}</div>
                </div>
              </div>
              {theme === "light" && (
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-brand text-brand-foreground shadow-sm">
                  <Check className="h-3 w-3 stroke-[3]" />
                </div>
              )}
            </div>
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <SectionLabel className="!mb-0">{t("appearance.chatBackground")}</SectionLabel>
            <p className="mt-1 break-words text-2xs text-zinc-600">{t("appearance.chatBackgroundDesc", { active })}</p>
          </div>
          <Button
            variant="ghost"
            className="gap-1 text-2xs text-zinc-500"
            onClick={clearBackground}
            size="xs"
          >
            <X className="h-3.5 w-3.5" />
            {t("appearance.reset")}
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => clearBackground()}
            className={cn(
              "h-8 rounded-md border px-2.5 text-2xs transition-colors",
              chatBackground?.kind === "none" || !chatBackground
                ? "border-brand/50 bg-brand/10 text-brand"
                : "border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300"
            )}
          >
            {t("appearance.none")}
          </button>
          {PRESET_COLORS.map((preset) => (
            <button
              key={preset.color}
              type="button"
              title={t(preset.nameKey)}
              onClick={() => applyColor(preset.color)}
              className={cn(
                "h-8 w-8 rounded-md border transition-transform",
                chatBackground?.kind === "color" &&
                  chatBackground.color === preset.color
                  ? "scale-110 border-brand/60"
                  : "border-zinc-700 hover:scale-105"
              )}
              style={{ backgroundColor: preset.color }}
            />
          ))}
        </div>

        <div className="mt-3 grid grid-cols-4 gap-2">
          {CHAT_PATTERNS.map((pattern) => {
            const selected =
              chatBackground?.kind === "pattern" &&
              chatBackground.patternId === pattern.id;
            return (
              <button
                key={pattern.id}
                type="button"
                title={t(PATTERN_NAME_KEYS[pattern.id])}
                onClick={() => applyPattern(pattern.id)}
                className={cn(
                  "group relative h-14 overflow-hidden rounded-lg border transition-all",
                  selected
                    ? "border-brand/60 ring-1 ring-brand/40"
                    : "border-zinc-800 hover:border-zinc-600"
                )}
                style={buildPatternBackground(pattern.id)}
              >
                <span
                  className={cn(
                    "absolute inset-0 flex items-center justify-center text-2xs text-zinc-200",
                    !selected && "opacity-0 transition-opacity group-hover:opacity-100"
                  )}
                >
                  {t(PATTERN_NAME_KEYS[pattern.id])}
                </span>
                {selected && (
                  <Check className="absolute right-1 top-1 h-3.5 w-3.5 text-brand" />
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="flex h-8 items-center gap-1.5 rounded-md border border-zinc-800 px-2.5 text-2xs text-zinc-300 hover:border-zinc-700 disabled:opacity-40"
          >
            <ImageIcon className="h-3.5 w-3.5" />
            {busy ? t("appearance.busy") : chatBackground?.kind === "image" ? t("appearance.changeImage") : t("appearance.chooseImage")}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void pickImage(e.target.files)}
          />
        </div>
        <p className="mt-2 break-words text-2xs text-zinc-600">{t("appearance.imageHint")}</p>
      </section>
    </div>
  );
}
