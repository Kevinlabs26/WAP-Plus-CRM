import { useState, useSyncExternalStore } from "react";
import { Activity, ArrowDownToLine, ArrowUpFromLine, Database, Sparkles } from "lucide-react";
import { useI18n } from "@/i18n";
import { Button, Input } from "@/components/ui/primitives";
import {
  getAiUsageSnapshot,
  subscribeAiUsage,
  summarizeAiUsage,
  usageDay,
  usageRateKey,
  saveAiUsageRate,
  clearAiUsageRate,
  type AiUsageBucket,
  type AiUsageRate,
} from "@/lib/aiUsage";
import { officialAiPriceInfo } from "@/lib/aiPricing";

const FEATURES = ["suggestion", "autoReply", "outreach", "translation", "insight", "transcription", "context", "image"] as const;
type ActivityMode = "day" | "week" | "total";
type ActivityValue = { tokens: number; requests: number };

const numberLabel = (value: number) => value.toLocaleString();
const blankActivity = (): ActivityValue => ({ tokens: 0, requests: 0 });

export function AiUsagePanel() {
  const { t, locale } = useI18n();
  const data = useSyncExternalStore(subscribeAiUsage, getAiUsageSnapshot);
  const today = usageDay();
  const month = today.slice(0, 7);
  const daily = data.buckets.filter((row) => row.day === today);
  const monthly = data.buckets.filter((row) => row.day.startsWith(month));
  const [period, setPeriod] = useState<"today" | "month">("month");
  const rows = period === "today" ? daily : monthly;
  const summary = summarizeAiUsage(rows, data.rates);
  const models = [...new Map(data.buckets.slice().reverse().map((row) => [usageRateKey(row), row])).values()];
  const money = (sum: ReturnType<typeof summarizeAiUsage>) => sum.priced
    ? `${sum.cost > 0 && sum.cost < 0.0001 ? "<$0.0001" : `$${sum.cost.toFixed(4)}`}${sum.unpriced || sum.unknown ? " + ?" : ""}`
    : sum.requests ? "—" : "$0.0000";
  const featureRows = FEATURES.map((feature) => ({
    feature,
    sum: summarizeAiUsage(rows.filter((row) => row.feature === feature), data.rates),
  })).filter(({ sum }) => sum.requests).sort((a, b) => b.sum.total - a.sum.total);
  const maxFeatureTokens = Math.max(1, ...featureRows.map(({ sum }) => sum.total));

  return (
    <section className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4">
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand/10 text-brand"><Sparkles className="h-4 w-4" /></span>
        <h3 className="font-semibold">{t("aiUsage.title")}</h3>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        {([ ["today", daily], ["month", monthly] ] as const).map(([key, list]) => {
          const sum = summarizeAiUsage(list, data.rates);
          return (
            <button
              type="button"
              key={key}
              aria-pressed={period === key}
              onClick={() => setPeriod(key)}
              className={`rounded-xl border p-3 text-left transition-colors ${period === key ? "border-brand bg-brand/10" : "border-[var(--app-border)] bg-[var(--app-surface-2)] hover:border-brand/50"}`}
            >
              <span className="text-xs text-[var(--app-muted)]">{t(`aiUsage.${key}`)}</span>
              <strong className="mt-1 block text-lg tabular-nums">{numberLabel(sum.total)} Token</strong>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-sm font-medium tabular-nums text-brand">{money(sum)}</span>
                <span className="text-xs text-[var(--app-muted)]">{t("aiUsage.requests", { count: sum.requests })}</span>
              </div>
            </button>
          );
        })}
      </div>

      {data.buckets.length > 0 && <ActivityChart buckets={data.buckets} locale={locale} />}

      {!!summary.requests && (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <UsageMetric icon={<ArrowDownToLine className="h-3.5 w-3.5" />} label={t("aiUsage.input")} value={summary.input} />
            <UsageMetric icon={<ArrowUpFromLine className="h-3.5 w-3.5" />} label={t("aiUsage.output")} value={summary.output} />
            <UsageMetric icon={<Database className="h-3.5 w-3.5" />} label={t("aiUsage.cached")} value={summary.cached} />
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold">{t("aiUsage.feature")}</h4>
              <span className="text-xs text-[var(--app-muted)]">{t("aiUsage.cost")}</span>
            </div>
            <div className="space-y-2">
              {featureRows.map(({ feature, sum }) => (
                <div key={feature} className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-2)] px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate font-medium">{t(`aiUsage.${feature}`)}</span>
                    <span className="shrink-0 tabular-nums text-[var(--app-muted)]">{numberLabel(sum.total)} Token · {money(sum)}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--app-border)]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(sum.total / maxFeatureTokens * 100)} aria-label={t(`aiUsage.${feature}`)}>
                      <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${Math.max(3, sum.total / maxFeatureTokens * 100)}%` }} />
                    </div>
                    <span className="w-20 shrink-0 text-right text-[11px] text-[var(--app-muted)]">{t("aiUsage.requests", { count: sum.requests })}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {!data.buckets.length && <p className="mt-3 rounded-xl bg-[var(--app-surface-2)] p-3 text-sm text-[var(--app-muted)]">{t("aiUsage.empty")}</p>}

      {!!models.length && (
        <details className="mt-4 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-2)]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 text-sm font-medium">
            <span>{t("aiUsage.prices")}</span>
            <span className="rounded-full bg-[var(--app-surface)] px-2 py-0.5 text-xs text-[var(--app-muted)]">{models.length}</span>
          </summary>
          <div className="border-t border-[var(--app-border)] p-3">
            <p className="mb-3 text-xs text-[var(--app-muted)]">{t("aiUsage.autoHint")}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {models.map((row) => <ModelPriceRow key={usageRateKey(row)} row={row} rate={data.rates[usageRateKey(row)]} />)}
            </div>
          </div>
        </details>
      )}

      {(data.error || data.limited) && <p role="alert" className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-600">{t(data.error ? "aiUsage.storageError" : "aiUsage.limited")}</p>}

      {(summary.unknown > 0 || summary.unpriced > 0 || summary.failed > 0) && (
        <details className="mt-3">
          <summary className="flex cursor-pointer flex-wrap gap-2 text-xs text-[var(--app-muted)]">
            {!!summary.unknown && <span className="rounded-full bg-amber-500/10 px-2 py-1 text-amber-600">{summary.unknown} {t("aiUsage.unknownShort")}</span>}
            {!!summary.unpriced && <span className="rounded-full bg-amber-500/10 px-2 py-1 text-amber-600">{summary.unpriced} {t("aiUsage.unpricedShort")}</span>}
            {!!summary.failed && <span className="rounded-full bg-[var(--app-surface-2)] px-2 py-1">{summary.failed} {t("aiUsage.failedShort")}</span>}
          </summary>
          <div className="mt-2 space-y-1 text-xs text-[var(--app-muted)]">
            {!!summary.unknown && <p>{t("aiUsage.unknown", { count: summary.unknown })}</p>}
            {!!summary.unpriced && <p>{t("aiUsage.unpriced", { count: summary.unpriced })}</p>}
            {!!summary.failed && <p>{t("aiUsage.failed", { count: summary.failed })}</p>}
          </div>
        </details>
      )}

      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-[var(--app-muted)]">{t("aiUsage.costDetails")}</summary>
        <p className="mt-2 text-xs leading-relaxed text-[var(--app-muted)]">{t("aiUsage.note")}</p>
      </details>
    </section>
  );
}

function UsageMetric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-2)] px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[11px] text-[var(--app-muted)]">{icon}<span className="truncate">{label}</span></div>
      <strong className="mt-1 block truncate text-sm tabular-nums">{numberLabel(value)}</strong>
    </div>
  );
}

function ActivityChart({ buckets, locale }: { buckets: AiUsageBucket[]; locale: string }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<ActivityMode>("day");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - 364 - today.getDay());
  const byDay = new Map<string, ActivityValue>();
  for (const row of buckets) {
    const value = byDay.get(row.day) || blankActivity();
    value.tokens += row.total;
    value.requests += row.requests;
    byDay.set(row.day, value);
  }
  const weeks = Array.from({ length: 53 }, (_, week) => Array.from({ length: 7 }, (_, weekday) => {
    const date = new Date(start);
    date.setDate(start.getDate() + week * 7 + weekday);
    const key = usageDay(date);
    return { date, key, value: date <= today ? byDay.get(key) || blankActivity() : null };
  }));
  const weekly = weeks.map((days) => ({
    start: days[0].date,
    end: days[6].date > today ? today : days[6].date,
    value: days.reduce((sum, day) => ({ tokens: sum.tokens + (day.value?.tokens || 0), requests: sum.requests + (day.value?.requests || 0) }), blankActivity()),
  }));
  const months = Array.from({ length: 13 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth() - 12 + index, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const value = buckets.filter((row) => row.day.startsWith(key)).reduce((sum, row) => ({ tokens: sum.tokens + row.total, requests: sum.requests + row.requests }), blankActivity());
    return { date, value };
  });
  const maxTokens = Math.max(1, ...(mode === "day"
    ? [...byDay.values()].map((item) => item.tokens)
    : mode === "week"
      ? weekly.map((item) => item.value.tokens)
      : months.map((item) => item.value.tokens)));
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const monthFormat = new Intl.DateTimeFormat(locale, { month: "short" });
  const amount = (value: ActivityValue) => `${numberLabel(value.tokens)} Token · ${t("aiUsage.requests", { count: value.requests })}`;
  const opacity = (tokens: number, requests: number) => !requests ? 0 : tokens ? 0.35 + 0.65 * Math.sqrt(tokens / maxTokens) : 0.35;
  const colorStyle = (value: ActivityValue) => value.requests ? { backgroundColor: `rgb(var(--brand-rgb) / ${opacity(value.tokens, value.requests)})` } : undefined;
  const tabClass = (active: boolean) => `rounded-lg px-2.5 py-1.5 text-xs transition-colors ${active ? "bg-brand/15 font-medium text-brand" : "text-[var(--app-muted)] hover:bg-[var(--app-surface)]"}`;
  const gridColumns = { gridTemplateColumns: `repeat(53, minmax(0, 1fr))` };
  const chartItems = mode === "day"
    ? weeks.flat().map((item) => ({ key: item.key, date: item.date, end: item.date, value: item.value || blankActivity() }))
    : weekly.map((item, index) => ({ key: String(index), date: item.start, end: item.end, value: item.value }));

  return (
    <section className="mt-4 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-2)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold"><Activity className="h-4 w-4 text-brand" />{t("aiUsage.activity")}</h4>
        <div className="flex rounded-xl bg-[var(--app-surface)] p-1" role="group" aria-label={t("aiUsage.activity")}>
          {(["day", "week", "total"] as const).map((item) => <button type="button" key={item} aria-pressed={mode === item} onClick={() => setMode(item)} className={tabClass(mode === item)}>{t(`aiUsage.${item === "day" ? "daily" : item === "week" ? "weekly" : "cumulative"}`)}</button>)}
        </div>
      </div>

      {mode !== "total" ? (
        <div className="mt-3 overflow-x-auto pb-1">
          <div className="min-w-[650px]">
            <div className="grid gap-1 text-[10px] text-[var(--app-muted)]" style={gridColumns}>
              {weeks.map((days, index) => {
                const monthChanged = index === 0 || days[0].date.getMonth() !== weeks[index - 1][0].date.getMonth();
                return <span key={index} className="truncate">{monthChanged ? monthFormat.format(days[0].date) : ""}</span>;
              })}
            </div>
            <div className={`mt-1 grid gap-1 ${mode === "day" ? "grid-flow-col grid-rows-7" : ""}`} style={gridColumns}>
              {chartItems.map(({ key, date, end, value }) => {
                const label = dateFormat.format(date);
                const title = `${label}${mode === "week" ? ` – ${dateFormat.format(end)}` : ""} · ${amount(value)}`;
                return (
                  <span
                    key={key}
                    title={title}
                    aria-label={title}
                    className={`aspect-square rounded-[3px] ${mode === "week" ? "min-w-2.5" : "min-w-0"} ${value.requests ? "ring-1 ring-black/10" : "bg-[var(--app-surface)] ring-1 ring-inset ring-[var(--app-border)]"}`}
                    style={colorStyle(value)}
                  />
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <span className="text-xs text-[var(--app-muted)]">{t("aiUsage.cumulative")}</span>
            <strong className="text-sm tabular-nums">{numberLabel(months.reduce((sum, item) => sum + item.value.tokens, 0))} Token</strong>
          </div>
          <div className="grid h-28 items-end gap-1.5 sm:gap-2" style={{ gridTemplateColumns: "repeat(13, minmax(0, 1fr))" }}>
            {months.map(({ date, value }) => (
              <div key={`${date.getFullYear()}-${date.getMonth()}`} className="flex h-full min-w-0 flex-col items-center justify-end gap-1" title={`${monthFormat.format(date)} ${date.getFullYear()} · ${amount(value)}`}>
                <div className="flex h-full w-full items-end overflow-hidden rounded-t-md bg-[var(--app-surface)]">
                  <div className="w-full rounded-t-md bg-brand transition-[height]" style={{ height: `${value.requests ? Math.max(5, value.tokens / maxTokens * 100) : 0}%`, opacity: opacity(value.tokens, value.requests) || 1 }} />
                </div>
                <span className="w-full truncate text-center text-[9px] text-[var(--app-muted)]">{monthFormat.format(date)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-2 flex items-center justify-end gap-1 text-[10px] text-[var(--app-muted)]">
        <span>{t("aiUsage.less")}</span>
        {[0, 1, 2, 3].map((step) => <span key={step} aria-hidden className="h-3 w-3 rounded-[3px] ring-1 ring-inset ring-[var(--app-border)]" style={step ? { backgroundColor: `rgb(var(--brand-rgb) / ${0.35 + (step - 1) * 0.325})` } : { backgroundColor: "var(--app-surface)" }} />)}
        <span>{t("aiUsage.more")}</span>
      </div>
    </section>
  );
}

function ModelPriceRow({ row, rate }: { row: AiUsageBucket; rate?: AiUsageRate }) {
  const { t } = useI18n();
  const official = officialAiPriceInfo(row.provider, row.model);
  const price = rate || official;
  const rates = (["input", "cached", "output", "cacheWrite"] as const);

  return (
    <article className="min-w-0 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-3">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <h5 className="truncate text-sm font-semibold" title={`${row.provider} · ${row.model}`}>{row.provider} · {row.model}</h5>
          <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] ${rate ? "bg-sky-500/10 text-sky-600" : official ? "bg-brand/10 text-brand" : "bg-amber-500/10 text-amber-600"}`}>
            {rate ? t("aiUsage.customPrice") : official ? t("aiUsage.officialPrice") : t("aiUsage.noOfficialPrice")}
          </span>
        </div>
        {official && <a href={official.source} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs text-brand hover:underline">{t("aiUsage.source")}</a>}
      </div>

      {price ? (
        <>
          <p className="mt-3 text-[10px] text-[var(--app-muted)]">{t("aiUsage.perMillion")}</p>
          <div className="mt-3 grid grid-cols-2 gap-1.5">
            {rates.map((key) => price[key] === undefined ? null : (
              <div key={key} className="rounded-lg bg-[var(--app-surface-2)] px-2 py-1.5">
                <span className="block truncate text-[10px] text-[var(--app-muted)]">{t(`aiUsage.${key}`)}</span>
                <strong className="mt-0.5 block text-xs tabular-nums">${price[key]}</strong>
              </div>
            ))}
          </div>
          {official && <p className="mt-2 text-[10px] text-[var(--app-muted)]">{t("aiUsage.checkedAt", { date: official.checkedAt })}</p>}
        </>
      ) : <p className="mt-2 text-xs text-[var(--app-muted)]">—</p>}

      <details className="mt-3 border-t border-[var(--app-border)] pt-2">
        <summary className="cursor-pointer text-xs text-[var(--app-muted)]">{t("aiUsage.customPrice")}</summary>
        <ModelPrice key={JSON.stringify(price)} row={row} rate={price} />
        {rate && <Button size="xs" className="mt-2" onClick={() => void clearAiUsageRate(usageRateKey(row))}>{t("aiUsage.useOfficial")}</Button>}
      </details>
    </article>
  );
}

function ModelPrice({ row, rate }: { row: AiUsageBucket; rate?: AiUsageRate }) {
  const { t } = useI18n();
  const [input, setInput] = useState(rate?.input.toString() ?? "");
  const [output, setOutput] = useState(rate?.output.toString() ?? "");
  const [cached, setCached] = useState(rate?.cached?.toString() ?? "");
  const [cacheWrite, setCacheWrite] = useState(rate?.cacheWrite?.toString() ?? "");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const valid = (text: string) => text.trim() !== "" && Number.isFinite(Number(text)) && Number(text) >= 0 && Number(text) <= 1e12;
  const change = (set: (value: string) => void) => (event: React.ChangeEvent<HTMLInputElement>) => { set(event.target.value); setSaved(false); };

  return (
    <div className="mt-2">
      <p className="text-[11px] text-[var(--app-muted)]">{t("aiUsage.priceHint")}</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {([ ["input", input, setInput], ["output", output, setOutput], ["cached", cached, setCached], ["cacheWrite", cacheWrite, setCacheWrite] ] as const).map(([key, value, set]) => (
          <label key={key} className="text-[11px] text-[var(--app-muted)]">
            {t(`aiUsage.${key}`)}
            <Input type="number" min="0" step="any" value={value} disabled={saving} onChange={change(set)} className="mt-1" placeholder={key === "cached" || key === "cacheWrite" ? input : "—"} />
          </label>
        ))}
      </div>
      <Button
        size="xs"
        className="mt-2"
        disabled={saving || !valid(input) || !valid(output) || (cached.trim() !== "" && !valid(cached)) || (cacheWrite.trim() !== "" && !valid(cacheWrite))}
        onClick={async () => {
          setSaving(true);
          try {
            await saveAiUsageRate(usageRateKey(row), { input: Number(input), output: Number(output), ...(cached.trim() ? { cached: Number(cached) } : {}), ...(cacheWrite.trim() ? { cacheWrite: Number(cacheWrite) } : {}) });
            setSaved(!getAiUsageSnapshot().error);
          } finally {
            setSaving(false);
          }
        }}
      >{t(saved ? "aiUsage.saved" : "aiUsage.save")}</Button>
    </div>
  );
}
