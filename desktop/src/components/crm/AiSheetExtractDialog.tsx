import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { Button, Input, Textarea } from "@/components/ui/primitives";
import { idbGet, idbSet } from "@/lib/idb";
import { appendSheetRow, initializeSheets, readSheet, sheetHeaders, tabRange, updateSheetCells, letter, useGoogleSheets } from "@/lib/googleSheets";
import { spreadsheetId } from "@/lib/googleSheetApi";
import { sheetInternationalPhone } from "@/lib/googleSheetMatch";
import { extractChatSheetFields } from "@/lib/aiCustomerCard";
import { hasAiCredentials } from "@/lib/aiProviders";
import { connectSheets } from "@/lib/googleSheets";
import type { Contact, Message } from "@/types/crm";
import type { AppSettings } from "@/store/appStore";

const CONFIG_KEY = "ai-chat-sheet-extraction-v1";
const PROFILES_KEY = "ai-chat-sheet-extraction-profiles-v1";
const MAX_PROFILES = 50;
type ColumnRule = { index: number; enabled: boolean; instructions: string };
type Config = { spreadsheet: string; tab: string; headerRow: number; matchColumn: number | null; columnRules: ColumnRule[]; headerSnapshot: string[]; instructions: string };
type Preview = { row: number | null; fields: { id: string; label: string; column: number; oldValue: string; value: string }[] };
const empty: Config = { spreadsheet: "", tab: "", headerRow: 1, matchColumn: null, columnRules: [], headerSnapshot: [], instructions: "" };
const phoneHeading = /phone|mobile|whatsapp|电话|号码|手机/i;

function cleanConfig(value: unknown): Config {
  if (!value || typeof value !== "object") return empty;
  const raw = value as Partial<Config>;
  const headerSnapshot = Array.isArray(raw.headerSnapshot) ? raw.headerSnapshot.filter((item): item is string => typeof item === "string").slice(0, 18_278).map(item => item.slice(0, 500)) : [];
  const columnRules = Array.isArray(raw.columnRules) ? raw.columnRules.slice(0, 18_278).flatMap(rule => rule && Number.isInteger(rule.index) && rule.index >= 0 && rule.index < 18_278 && typeof rule.enabled === "boolean" ? [{ index: rule.index, enabled: rule.enabled, instructions: typeof rule.instructions === "string" ? rule.instructions.slice(0, 1000) : "" }] : []) : [];
  return { spreadsheet: typeof raw.spreadsheet === "string" ? raw.spreadsheet.slice(0, 2048) : "", tab: typeof raw.tab === "string" ? raw.tab.slice(0, 200) : "", headerRow: Number.isInteger(raw.headerRow) && raw.headerRow! >= 1 && raw.headerRow! <= 100_000 ? raw.headerRow! : 1, matchColumn: Number.isInteger(raw.matchColumn) && raw.matchColumn! >= 0 && raw.matchColumn! < 18_278 ? raw.matchColumn! : null, columnRules, headerSnapshot, instructions: typeof raw.instructions === "string" ? raw.instructions.slice(0, 4000) : "" };
}

function profileKey(config: Config) {
  const id = spreadsheetId(config.spreadsheet);
  return id && config.tab ? JSON.stringify([id, config.tab]) : "";
}

function cleanProfiles(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, Config>;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(-MAX_PROFILES).flatMap(([key, value]) => {
    const config = cleanConfig(value);
    return profileKey(config) === key ? [[key, config]] : [];
  }));
}

function blankTabConfig(config: Config, tab: string): Config {
  return { ...config, tab, headerRow: 1, matchColumn: null, columnRules: [], headerSnapshot: [] };
}

export function AiSheetExtractDialog({ contact, messages, accountId, settings, onClose, onWritten }: { contact: Contact; messages: Message[]; accountId?: string; settings: AppSettings; onClose: () => void; onWritten: () => void }) {
  const { t } = useI18n();
  const sheets = useGoogleSheets();
  const [config, setConfig] = useState<Config>(empty);
  const [tabs, setTabs] = useState<string[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const profilesRef = useRef<Record<string, Config>>({});
  const id = spreadsheetId(config.spreadsheet);
  const connected = sheets.configured && !!sheets.email && !sheets.needsAccess;
  const columns = useMemo(() => headers.map((heading, index) => ({ heading, index })), [headers]);
  const phoneColumns = useMemo(() => columns.filter(({ heading }) => phoneHeading.test(heading)), [columns]);

  useEffect(() => {
    let active = true;
    void Promise.all([idbGet<Config>(CONFIG_KEY), idbGet<unknown>(PROFILES_KEY)]).then(([legacyValue, storedValue]) => {
      if (!active) return;
      const saved = cleanProfiles(storedValue);
      const legacy = cleanConfig(legacyValue);
      const key = profileKey(legacy);
      if (key && !saved[key]) saved[key] = legacy;
      profilesRef.current = saved;
      setConfig(key && saved[key] ? saved[key] : legacy);
      setConfigLoaded(true);
    }).catch(error => {
      if (!active) return;
      setError(`无法读取本机表格配置：${String(error)}`);
      setConfigLoaded(true);
    });
    return () => { active = false; };
  }, []);
  useEffect(() => { if (!configLoaded) return; const timer = window.setTimeout(() => { void save(config).catch(error => setError(`保存表格配置失败：${String(error)}`)); }, 250); return () => window.clearTimeout(timer); }, [config, configLoaded]);
  useEffect(() => { void initializeSheets(); }, []);
  const update = (patch: Partial<Config>) => { if ("spreadsheet" in patch || "tab" in patch) void saveProfile(config).catch(error => setError(`保存表格配置失败：${String(error)}`)); setPreview(null); setError(""); setConfig(current => ({ ...current, ...patch })); };

  async function saveProfile(next: Config) {
    const key = profileKey(next);
    if (!key) return;
    const updated = { ...profilesRef.current };
    delete updated[key];
    updated[key] = next;
    const bounded = Object.fromEntries(Object.entries(updated).slice(-MAX_PROFILES));
    profilesRef.current = bounded;
    await idbSet(PROFILES_KEY, bounded);
  }

  async function save(next = config) {
    await idbSet(CONFIG_KEY, next);
    await saveProfile(next);
  }

  async function changeTab(tab: string) {
    void saveProfile(config).catch(error => setError(`保存表格配置失败：${String(error)}`));
    setPreview(null); setError(""); setHeaders([]);
    if (!tab) { setConfig(current => ({ ...current, tab: "", matchColumn: null, columnRules: [], headerSnapshot: [] })); return; }
    const key = profileKey({ ...config, tab });
    const stored = key ? profilesRef.current[key] : undefined;
    const next = stored ? { ...stored, spreadsheet: config.spreadsheet } : blankTabConfig(config, tab);
    setConfig(next); setBusy(true);
    try { await loadHeaders(id, tab, next.headerRow, next); }
    catch (error) { setError(String(error).replace(/^Error: /, "")); }
    finally { setBusy(false); }
  }

  async function closeDialog() {
    try { if (configLoaded) await save(config); onClose(); }
    catch (error) { setError(`保存表格配置失败：${String(error)}`); }
  }

  async function loadTabs() {
    if (!id || !connected) return;
    setBusy(true); setError("");
    try {
      const metadata = await readSheet(id);
      const next = metadata.sheets?.map(item => item.properties.title) || [];
      if (!next.length) throw Error("表格没有可用子表");
      setTabs(next);
      const tab = next.includes(config.tab) ? config.tab : next[0];
      const key = profileKey({ ...config, tab });
      const saved = key ? profilesRef.current[key] : undefined;
      const nextConfig = saved ? { ...saved, spreadsheet: config.spreadsheet } : blankTabConfig(config, tab);
      setConfig(nextConfig); await save(nextConfig);
      await loadHeaders(id, tab, nextConfig.headerRow, nextConfig);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  async function loadHeaders(sheetId = id, tab = config.tab, row = config.headerRow, source = config) {
    if (!sheetId || !tab || !Number.isInteger(row) || row < 1) return;
    const next = await sheetHeaders(sheetId, tab, row);
    if (!next.some(value => value.trim())) throw Error("所选行没有列名，请检查表头行");
    const names = next.map(value => value.trim());
    const oldNames = source.headerSnapshot;
    const oldIndexToNew = (index: number | undefined) => {
      const oldHeading = index === undefined ? "" : oldNames[index];
      const hits = oldHeading ? names.flatMap((heading, nextIndex) => heading === oldHeading ? [nextIndex] : []) : [];
      return hits.length === 1 ? hits[0] : undefined;
    };
    const recommended = names.findIndex(value => phoneHeading.test(value));
    const remappedRules = source.columnRules.flatMap(rule => {
      const index = oldIndexToNew(rule.index);
      return index === undefined ? [] : [{ ...rule, index }];
    });
    const columnRules = names.map((_, index) => remappedRules.find(rule => rule.index === index) || { index, enabled: true, instructions: "" });
    const priorMatch = oldIndexToNew(source.matchColumn ?? undefined);
    const matchColumn = priorMatch !== undefined && phoneHeading.test(names[priorMatch])
      ? priorMatch
      : source.headerSnapshot.length ? null : recommended >= 0 ? recommended : null;
    const nextConfig = { ...source, matchColumn, columnRules, headerSnapshot: names };
    setHeaders(names); setConfig(nextConfig); await save(nextConfig);
  }

  async function loadHeadersFromUi() {
    setBusy(true); setError("");
    try { const next = { ...config, headerRow: Number(config.headerRow) }; await loadHeaders(id, next.tab, next.headerRow, next); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  async function makePreview() {
    if (!id || !config.tab || !headers.length) { setError("请先选择目标子表并读取列名。"); return; }
    const matchIndex = config.matchColumn;
    const selectedColumns = config.columnRules.filter(rule => rule.enabled && rule.index !== matchIndex && !!headers[rule.index]?.trim());
    if (!selectedColumns.length) { setError("请至少勾选一列要提取写入的内容。"); return; }
    const mapped = [
      ...(matchIndex === null ? [] : [{ id: `col_${matchIndex}`, label: headers[matchIndex] || "电话号码", column: matchIndex, instructions: "" }]),
      ...selectedColumns.map(rule => ({ id: `col_${rule.index}`, label: headers[rule.index], column: rule.index, instructions: rule.instructions })),
    ];
    if ((matchIndex !== null && matchIndex >= headers.length) || mapped.some(field => field.column >= headers.length) || JSON.stringify(headers) !== JSON.stringify(config.headerSnapshot)) { setError("表格列名或位置已变化，请重新读取列名并确认。"); return; }
    if (new Set(mapped.map(field => field.column)).size !== mapped.length) { setError("表格列配置重复，请重新读取列名。"); return; }
    if (mapped.length > 98) { setError("一次最多处理 98 列，请减少勾选列数。"); return; }
    setBusy(true); setError(""); setPreview(null);
    try {
      const aiFields = mapped.filter(field => field.column !== matchIndex).map(field => ({ id: field.id, label: field.label, instructions: field.instructions }));
      const extracted = aiFields.length ? await extractChatSheetFields(contact, messages, settings, aiFields, config.instructions, accountId) : {};
      const values = Object.fromEntries(mapped.map(field => [field.id, field.column === matchIndex ? contact.phone || "" : extracted[field.id] || ""]));
      const readColumns = mapped.filter(field => field.column !== matchIndex).map(field => field.column);
      const ranges = matchIndex === null ? [] : [
        `${tabRange(config.tab)}!${letter(matchIndex)}${config.headerRow + 1}:${letter(matchIndex)}`,
        ...readColumns.map(column => `${tabRange(config.tab)}!${letter(column)}${config.headerRow + 1}:${letter(column)}`),
      ];
      const response = ranges.length ? await readSheet(id, ranges) : null;
      const valueRanges = response?.valueRanges || [];
      if (ranges.length && valueRanges.length !== ranges.length) throw Error("读取表格不完整，请重试");
      let matches: number[] = [];
      if (matchIndex !== null) {
        const phone = sheetInternationalPhone(contact.phone);
        if (!phone) throw Error("客户电话号码不是有效的国际号码，无法安全匹配。");
        matches = (valueRanges[0]?.values?.[0] || []).flatMap((value, index) => sheetInternationalPhone(String(value)) === phone ? [index + config.headerRow + 1] : []);
      }
      if (matches.length > 1) throw Error(`表格中有 ${matches.length} 行匹配此号码，已停止，避免写错客户。请先合并重复行。`);
      const row = matches[0] || null;
      const oldValues = new Map(readColumns.map((column, index) => [column, String(valueRanges[index + 1]?.values?.[0]?.[row ? row - config.headerRow - 1 : -1] || "")]));
      const fields = mapped.flatMap(field => {
        if (row && field.column === matchIndex) return [];
        const value = values[field.id] || "";
        const oldValue = row ? oldValues.get(field.column) || "" : "";
        return value && value !== oldValue ? [{ id: field.id, label: field.label, column: field.column, oldValue, value }] : [];
      });
      const next = { row, fields };
      setPreview(next); await save(config);
    } catch (e) { setError(String(e).replace(/^Error: /, "")); }
    finally { setBusy(false); }
  }

  async function writePreview() {
    if (!preview || !id) return;
    setBusy(true); setError("");
    try {
      const matchIndex = config.matchColumn;
      const freshHeaders = await sheetHeaders(id, config.tab, config.headerRow);
      if (JSON.stringify(freshHeaders.map(value => value.trim())) !== JSON.stringify(config.headerSnapshot)) throw Error("表格列名或顺序已变化，已取消写入。请重新读取列名并预览。");
      const updateFields = preview.fields.filter(field => field.column !== matchIndex);
      const ranges = matchIndex === null ? [] : [
        `${tabRange(config.tab)}!${letter(matchIndex)}${config.headerRow + 1}:${letter(matchIndex)}`,
        ...updateFields.map(field => `${tabRange(config.tab)}!${letter(field.column)}${config.headerRow + 1}:${letter(field.column)}`),
      ];
      const check = ranges.length ? await readSheet(id, ranges) : null;
      if (ranges.length && check?.valueRanges?.length !== ranges.length) throw Error("读取表格不完整，已取消写入，请重新预览。");
      const phone = matchIndex === null ? null : sheetInternationalPhone(contact.phone);
      if (matchIndex !== null && !phone) throw Error("客户电话号码不是有效的国际号码，已取消写入。");
      const matches = matchIndex === null ? [] : (check?.valueRanges?.[0]?.values?.[0] || []).flatMap((value, index) => sheetInternationalPhone(String(value)) === phone ? [index + config.headerRow + 1] : []);
      if (preview.row === null) {
        if (matchIndex !== null && matches.length) throw Error("预览后表格已有此客户，已取消新增。请重新预览。");
        const rowValues: string[] = Array(headers.length).fill("");
        if (matchIndex !== null) rowValues[matchIndex] = contact.phone;
        for (const field of preview.fields) rowValues[field.column] = field.value;
        await appendSheetRow(id, config.tab, rowValues);
      } else {
        if (matchIndex === null) throw Error("当前表格未设置号码匹配，只能新增行；请重新生成预览。");
        if (matches.length !== 1 || matches[0] !== preview.row) throw Error("预览后匹配行发生变化，已取消写入。请重新预览。");
        const rowOffset = preview.row - config.headerRow - 1;
        if (updateFields.some((field, index) => String(check?.valueRanges?.[index + 1]?.values?.[0]?.[rowOffset] || "") !== field.oldValue)) throw Error("预览后表格内容发生变化，已取消写入。请重新预览。");
        const updates = updateFields.map(field => [field.column, field.value] as [number, string]);
        await updateSheetCells(id, config.tab, preview.row, updates);
      }
      onWritten();
      onClose();
    } catch (e) { setError(String(e).replace(/^Error: /, "")); }
    finally { setBusy(false); }
  }

  return <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/65 p-4" onMouseDown={event => { if (event.target === event.currentTarget && !busy) void closeDialog(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="ai-sheet-title" className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl">
      <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-4"><h2 id="ai-sheet-title" className="font-semibold">整理聊天到 Google 表格</h2><Button size="xs" variant="ghost" disabled={busy} onClick={() => void closeDialog()}>{t("common.close")}</Button></header>
      <div className="space-y-4 overflow-y-auto p-5 text-sm">
        {!sheets.ready ? <p role="status" className="rounded-lg border border-zinc-700 p-3 text-zinc-400">正在检查 Google Sheets 连接…</p> : !sheets.configured ? <div role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-5 text-amber-300"><p>{sheets.email ? `已发现原来登录的 Google 账号：${sheets.email}。此开发版没有包含 Google OAuth 客户端配置，登录 token 过期后无法续期；这是构建配置问题，不需要重新登录。` : "此开发版没有包含 Google OAuth 客户端配置，暂时无法连接 Google Sheets。"}</p><p className="mt-1 text-zinc-400">本功能和原来的 Google Sheets 共用授权；需要用同一个 Google OAuth 客户端配置重新构建开发版。</p></div> : sheets.email && sheets.needsAccess ? <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-300"><p>已登录：{sheets.email}，但缺少表格写入权限。</p><Button size="sm" className="mt-2" disabled={sheets.busy} onClick={() => void connectSheets()}>补充 Google Sheets 权限</Button></div> : !connected ? <div className="rounded-lg border border-zinc-700 p-3 text-zinc-400"><p>先连接 Google Sheets（此配置与快捷话术表格分开保存）。</p><Button size="sm" className="mt-2" disabled={sheets.busy} onClick={() => void connectSheets()}>连接 Google Sheets</Button></div> : <>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]"><label className="text-xs text-zinc-400">目标 Google 工作簿<Input className="mt-1" value={config.spreadsheet} onChange={event => { update({ spreadsheet: event.target.value, tab: "", headerSnapshot: [], matchColumn: null, columnRules: [] }); setTabs([]); setHeaders([]); }} placeholder="粘贴工作簿链接" /></label><Button size="sm" className="self-end" disabled={!id || busy} onClick={() => void loadTabs()}>{busy ? "读取中…" : "读取子表"}</Button></div>
          {tabs.length > 0 && <div className="grid gap-3 sm:grid-cols-3"><label className="text-xs text-zinc-400">目标子表<select className="ui-control mt-1 w-full px-2 py-2" value={config.tab} onChange={event => void changeTab(event.target.value)}><option value="">选择子表</option>{tabs.map(tab => <option key={tab}>{tab}</option>)}</select></label><label className="text-xs text-zinc-400">表头所在行<Input type="number" min={1} max={100000} className="mt-1" value={config.headerRow} onChange={event => { update({ headerRow: Number(event.target.value), headerSnapshot: [], matchColumn: null, columnRules: [] }); setHeaders([]); }} /></label><Button size="sm" className="self-end" disabled={busy || !config.tab} onClick={() => void loadHeadersFromUi()}>{busy ? "读取中…" : "读取列名"}</Button></div>}
          {headers.length > 0 && <>
            <label className="block text-xs text-zinc-400">号码匹配列（可选）<select className="ui-control mt-1 w-full px-2 py-2" value={config.matchColumn ?? ""} onChange={event => { const matchColumn = event.target.value === "" ? null : Number(event.target.value); update({ matchColumn, columnRules: matchColumn === null ? config.columnRules : config.columnRules.map(rule => rule.index === matchColumn ? { ...rule, enabled: true } : rule) }); }}><option value="">不匹配，每次新增一行</option>{phoneColumns.map(({heading,index})=><option key={index} value={index}>{letter(index)} · {heading}</option>)}</select></label>
            <div className="rounded-xl border border-zinc-800"><div className="border-b border-zinc-800 px-3 py-2 text-xs text-zinc-400">表格列 · 勾选要写入的列，可为每列补充提取要求</div><div className="divide-y divide-zinc-800/70">{columns.filter(({heading}) => !!heading.trim()).map(({heading,index}) => { const rule = config.columnRules.find(item => item.index === index) || { index, enabled: true, instructions: "" }; const isMatch = config.matchColumn === index; return <div key={index} className="grid gap-2 px-3 py-2 sm:grid-cols-[minmax(130px,0.8fr)_1.2fr] sm:items-center"><label className="flex min-w-0 items-center gap-2 text-xs"><input type="checkbox" checked={isMatch || rule.enabled} disabled={isMatch} onChange={event => update({ columnRules: config.columnRules.map(item => item.index === index ? { ...item, enabled: event.target.checked } : item) })} /><span className="truncate" title={`${letter(index)} · ${heading}`}>{letter(index)} · {heading}{isMatch ? "（号码匹配）" : ""}</span></label><Input size="sm" value={rule.instructions} maxLength={1000} disabled={isMatch} aria-label={`${heading} 提取要求`} placeholder={isMatch ? "号码自动写入" : "提取要求（可选，留空按列名判断）"} onChange={event => update({ columnRules: config.columnRules.map(item => item.index === index ? { ...item, instructions: event.target.value } : item) })} /></div>; })}</div></div>
            <label className="block text-xs text-zinc-400">提取补充要求（可选）<Textarea className="mt-1 min-h-20" maxLength={4000} value={config.instructions} onChange={event => update({ instructions: event.target.value })} placeholder="例如：需求只记录客户明确说过的内容；下一步写成一句可执行动作。" /></label>
            <p className="text-[11px] text-zinc-500">列名直接读取当前子表；AI 按列名和提取要求填写。每个子表的设置保存在本机。号码匹配可选；不匹配时每次新增一行，无法自动去重。空值不覆盖，写入前会显示预览。</p>
            <div className="flex justify-end"><Button size="sm" variant="primary" disabled={busy || !hasAiCredentials(settings)} onClick={() => void makePreview()}>{busy ? "处理中…" : "生成写入预览"}</Button></div>
          </>}
        </>}
        {error && <p role="alert" className="rounded-lg bg-amber-500/10 p-3 text-xs text-amber-400">{error}</p>}
        {preview && <div className="space-y-2 rounded-xl border border-brand/40 bg-brand/5 p-3"><div className="font-medium">{preview.row ? `将更新第 ${preview.row} 行` : "将新增客户行"}</div>{preview.fields.length ? preview.fields.map(field=><div key={field.id} className="grid gap-1 border-t border-zinc-800/70 pt-2 text-xs sm:grid-cols-[120px_1fr]"><span className="text-zinc-400">{field.label}{field.oldValue ? "（覆盖）" : ""}</span><span className="break-words">{field.oldValue && <><span className="text-zinc-500 line-through">{field.oldValue}</span> → </>}{field.value}</span></div>) : <p className="text-xs text-zinc-400">没有需要写入的新内容。</p>}<div className="flex justify-end gap-2 pt-2"><Button size="sm" disabled={busy} onClick={() => setPreview(null)}>返回修改</Button><Button size="sm" variant="primary" disabled={busy || !preview.fields.length} onClick={() => void writePreview()}>{busy ? "写入中…" : "确认写入表格"}</Button></div></div>}
      </div>
    </section>
  </div>;
}
