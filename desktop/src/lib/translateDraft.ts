import { readAiJson } from "./aiResponse.ts";
import { trackAiRequest } from "./aiUsage.ts";
import { vertexAiConfig } from "./vertexAi.ts";
import { getTranslationSettings } from "./translationConfig.ts";
import type { Contact } from "@/types/crm";
import type { AppSettings } from "@/store/appStore";
import { franc } from "franc-min";
import { geminiGenerate } from "./gemini.ts";
import { getOpenAiCompatibleConfig, hasAiCredentials, chatCompletionOptions } from "./aiProviders.ts";

export type TranslateLangCode =
  | "en"
  | "zh"
  | "fr"
  | "es"
  | "de"
  | "pt"
  | "ru"
  | "ar"
  | "ja"
  | "ko"
  | "auto";

export const TRANSLATE_LANGS: {
  code: Exclude<TranslateLangCode, "auto">;
  label: string;
  native: string;
}[] = [
  { code: "en", label: "English", native: "EN" },
  { code: "zh", label: "中文", native: "中文" },
  { code: "fr", label: "Français", native: "FR" },
  { code: "es", label: "Español", native: "ES" },
  { code: "de", label: "Deutsch", native: "DE" },
  { code: "pt", label: "Português", native: "PT" },
  { code: "ru", label: "Русский", native: "RU" },
  { code: "ar", label: "العربية", native: "AR" },
  { code: "ja", label: "日本語", native: "JA" },
  { code: "ko", label: "한국어", native: "KO" },
];

const LANG_NAME: Record<string, string> = {
  en: "English",
  zh: "Simplified Chinese",
  fr: "French",
  es: "Spanish",
  de: "German",
  pt: "Portuguese",
  ru: "Russian",
  ar: "Arabic",
  ja: "Japanese",
  ko: "Korean",
};

export function langShortLabel(code: string): string {
  if (code === "auto") return "自动";
  return TRANSLATE_LANGS.find((l) => l.code === code)?.native || code.toUpperCase();
}

/** 拉丁语系常用词的轻量语言指纹（用于区分英/法/西/葡/德） */
type LatinProfile = {
  code: Exclude<TranslateLangCode, "auto">;
  words: string[];
  /** 高区分度字符：几乎只在某语言出现，命中加权 4 */
  strong: string;
  /** 常见变音字符：多语言共用，命中加权 1 */
  general: string;
};

const LATIN_PROFILES: LatinProfile[] = [
  {
    code: "en",
    words: [
      "hello", "hi", "hey", "thanks", "thank", "please", "how", "much",
      "cost", "price", "what", "where", "when", "you", "your", "the",
      "and", "for", "with", "this", "that", "have", "can", "do", "not",
      "yes", "no", "want", "send", "order", "shipping",
    ],
    strong: "",
    general: "",
  },
  {
    code: "fr",
    words: [
      "bonjour", "salut", "merci", "oui", "non", "vous", "etes", "est",
      "tres", "pour", "avec", "comment", "quoi", "je", "tu", "le", "la",
      "les", "des", "et", "pas", "sur", "que", "un", "une", "nous",
      "voulez", "combien", "prix", "envoi", "livraison", "bonne", "journee",
      // 日常闲聊高频词
      "de", "mon", "ma", "mes", "cote", "côté", "ça", "va", "aussi",
      "bien", "frere", "frère", "ami", "suis", "ai", "as", "toujours",
      "beaucoup", "tres", "tout", "rien", "vraiment", "après", "apres",
      "avant", "maintenant", "notre", "votre", "chez", "au", "aux",
      "pas", "dans", "sur", "chez", "mais", "donc", "car", "si",
    ],
    strong: "çèêëàùôîûœ",
    general: "é",
  },
  {
    code: "es",
    words: [
      "hola", "buenos", "buenas", "dias", "tardes", "gracias", "quiero",
      "usted", "cuanto", "precio", "como", "que", "para", "con", "los",
      "las", "por", "es", "no", "el", "un", "una", "y", "mas", "envio",
      "buen", "día", "cómo", "cuánto", "está", "esta", "hacer", "pedido",
      // 日常闲聊高频词
      "amigo", "bien", "estas", "estás", "muy", "pero", "tambien", "también",
      "porque", "cuando", "donde", "dónde", "en", "de", "del", "se", "me",
      "te", "nos", "hay", "más", "precio", "costo", "envio", "envío",
    ],
    strong: "ñ¿¡",
    general: "áéíóúü",
  },
  {
    code: "pt",
    words: [
      "ola", "obrigado", "obrigada", "bom", "boa", "dia", "quanto", "custa",
      "preco", "preço", "eu", "voce", "você", "para", "com", "os", "as",
      "e", "nao", "não", "tem", "pode", "sim", "enviar", "entrega", "pedido",
      // 日常闲聊高频词
      "amigo", "bem", "tudo", "vc", "voce", "mas", "muito", "quando",
      "onde", "porque", "no", "na", "do", "da", "me", "se", "nós", "nos",
      "tambem", "também", "preço", "custo", "envio", "envio",
    ],
    strong: "ãõ",
    general: "áâàéêíóôúç",
  },
  {
    code: "de",
    words: [
      "hallo", "danke", "guten", "tag", "bitte", "wie", "viel", "kostet",
      "ich", "du", "der", "die", "das", "und", "nicht", "ist", "mit",
      "für", "fuer", "was", "können", "koennen", "ja", "nein", "sie",
      "mir", "mein", "preis", "versand", "bestellung",
      // 日常闲聊高频词
      "freund", "gut", "sehr", "aber", "auch", "wir", "ihr", "den",
      "dem", "ein", "eine", "zu", "von", "im", "am", "bin", "habe",
      "hast", "kann", "möchte", "moechte", "danke", "schön", "schon",
    ],
    strong: "ßäöü",
    general: "",
  },
];

const LATIN_WORD_SETS = LATIN_PROFILES.map((profile) => ({
  code: profile.code,
  set: new Set(profile.words),
  strong: profile.strong,
  general: profile.general,
}));

// —— franc-min：成熟的 trigram 语言检测库，中长文本更可靠 ——
const FRANC_WHITELIST = [
  "eng", "cmn", "yue", "jpn", "kor", "fra", "spa", "deu", "por", "rus", "ara",
];
const FRANC_TO_OURS: Record<string, Exclude<TranslateLangCode, "auto">> = {
  eng: "en",
  cmn: "zh",
  yue: "zh",
  jpn: "ja",
  kor: "ko",
  fra: "fr",
  spa: "es",
  deu: "de",
  por: "pt",
  rus: "ru",
  ara: "ar",
};

/** 字符集检测：中日韩俄阿拉伯几乎 100% 可靠，短句也不怕 */
function detectByScript(t: string): Exclude<TranslateLangCode, "auto"> | null {
  let han = 0, hira = 0, kata = 0, hangul = 0, cyr = 0, arab = 0, latin = 0;
  for (const ch of t) {
    const c = ch.codePointAt(0) || 0;
    if (c >= 0x4e00 && c <= 0x9fff) han += 1;
    else if (c >= 0x3040 && c <= 0x309f) hira += 1;
    else if ((c >= 0x30a0 && c <= 0x30ff) || (c >= 0x31f0 && c <= 0x31ff)) kata += 1;
    else if (c >= 0xac00 && c <= 0xd7a3) hangul += 1;
    else if (c >= 0x0400 && c <= 0x04ff) cyr += 1;
    else if (c >= 0x0600 && c <= 0x06ff) arab += 1;
    else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) latin += 1;
  }
  const total = han + hira + kata + hangul + cyr + arab + latin;
  if (total === 0) return null;
  // 假名（平/片假名）是日语独有字符集，出现即为日语。此判定必须先于
  // 汉字比例——日语正文普遍混有汉字，「私は東京に行きました」这类常见句
  // 的 han 占比远超 0.15，若先判汉字会把日语一律误判成中文。
  if (hira + kata > 0) return "ja";
  if (han / total > 0.15) return "zh";
  if (hangul / total > 0.25) return "ko";
  if (cyr / total > 0.25) return "ru";
  if (arab / total > 0.25) return "ar";
  if (latin / total < 0.3) return null;
  return null;
}

/** 拉丁语启发式：常用词 + 特有字符打分，专补短句/闲聊（franc 的盲区） */
function heuristicLatin(t: string): { code: Exclude<TranslateLangCode, "auto"> | null; score: number } {
  const tokens = t.toLowerCase().match(/[\p{L}]+/gu) || [];
  if (!tokens.length) return { code: null, score: 0 };
  let best: Exclude<TranslateLangCode, "auto"> | null = null;
  let bestScore = 0;
  for (const { code, set, strong, general } of LATIN_WORD_SETS) {
    let score = 0;
    for (const token of tokens) if (set.has(token)) score += 2;
    if (strong) {
      for (const ch of t) if (strong.includes(ch)) score += 4;
    }
    if (general) {
      for (const ch of t) if (general.includes(ch)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = code;
    }
  }
  return { code: best, score: bestScore };
}

/**
 * 语言检测（三层融合）：
 * 1. 字符集 → 中日韩俄阿（可靠）
 * 2. franc-min 白名单 → 中长文本准
 * 3. 启发式 → 短句/特有字符；与 franc 一致时直接采信，不一致且启发式信号强则信启发式
 * 无把握返回 null（交由全局默认语言）。
 */
export function detectMessageLanguage(
  text: string
): Exclude<TranslateLangCode, "auto"> | null {
  const t = (text || "").trim();
  if (!t) return null;

  const script = detectByScript(t);
  if (script) return script;

  let francCode: Exclude<TranslateLangCode, "auto"> | null = null;
  try {
    const raw = franc(t, { only: FRANC_WHITELIST });
    francCode = FRANC_TO_OURS[raw] || null;
  } catch {
    francCode = null;
  }

  const heur = heuristicLatin(t);

  if (francCode && francCode === heur.code) return francCode;
  // 短句：启发式信号强（≥2 个常见词或 1 个强特有字符）优先于 franc 的猜测
  if (heur.code && heur.score >= 3) return heur.code;
  if (francCode) return francCode;
  return heur.code;
}

export type TargetLanguage = {
  code: Exclude<TranslateLangCode, "auto">;
  source: "preferred" | "country" | "message" | "default";
};

/** 客户默认译出语：preferredLang > 国家启发式 > 最近入站消息自动检测 > 设置默认。 */
export function resolveTargetLanguage(
  contact: Pick<Contact, "preferredLang" | "country"> | undefined,
  settings: AppSettings,
  lastInboundBody?: string
): TargetLanguage {
  const pref = (contact?.preferredLang || "").toLowerCase();
  if (pref && pref !== "auto" && LANG_NAME[pref]) {
    return { code: pref as TargetLanguage["code"], source: "preferred" };
  }
  const country = (contact?.country || "").toLowerCase();
  if (/france|法国|fr\b/.test(country)) return { code: "fr", source: "country" };
  if (/spain|西班牙|es\b|mexico|墨西哥/.test(country)) return { code: "es", source: "country" };
  if (/germany|德国|de\b|austria|瑞士/.test(country)) return { code: "de", source: "country" };
  if (/brazil|brasil|葡萄牙|portugal/.test(country)) return { code: "pt", source: "country" };
  if (/russia|俄罗斯|ru\b/.test(country)) return { code: "ru", source: "country" };
  if (/japan|日本|jp\b/.test(country)) return { code: "ja", source: "country" };
  if (/korea|韩国|kr\b/.test(country)) return { code: "ko", source: "country" };
  if (/arab|saudi|uae|dubai|埃及|qatar/.test(country)) return { code: "ar", source: "country" };
  if (/china|中国|cn\b|taiwan|香港|singapore/.test(country)) return { code: "zh", source: "country" };

  // 客户最近一次用对方语言发来的消息，最可信：自动按它默认译出语，省去每个会话手选
  if (lastInboundBody) {
    const detected = detectMessageLanguage(lastInboundBody);
    if (detected) return { code: detected, source: "message" };
  }

  const def = (settings.translateTargetLang || "en").toLowerCase();
  if (def && def !== "auto" && LANG_NAME[def]) {
    return { code: def as TargetLanguage["code"], source: "default" };
  }
  return { code: "en", source: "default" };
}

export function resolveTargetLang(
  contact: Contact | undefined,
  settings: AppSettings,
  lastInboundBody?: string
): TargetLanguage["code"] {
  return resolveTargetLanguage(contact, settings, lastInboundBody).code;
}

/**
 * 我的语言（入站翻译目标，给自己看）：
 * 显式 myLang > 消息设置里的默认目标语言 > 系统/浏览器语言 > en。
 * 这样旧版本没有 myLang 控件时，用户在“默认目标语言”里选择的语言
 * 也会真正用于消息翻译和语音转写后的译文。
 */
export function resolveMyLang(settings: AppSettings): string {
  const set = (settings.myLang || "").trim().toLowerCase();
  if (set && LANG_NAME[set]) return set;
  const configured = (settings.translateTargetLang || "").trim().toLowerCase();
  if (configured && LANG_NAME[configured]) return configured;
  if (typeof navigator !== "undefined") {
    const raw = (navigator.language || navigator.languages?.[0] || "")
      .toLowerCase()
      .split("-")[0];
    if (raw && LANG_NAME[raw]) return raw;
  }
  return "en";
}

export interface TranslateResult {
  text: string;
  source:
    | "mock"
    | "openai"
    | "groq"
    | "deepseek"
    | "qwen"
    | "zhipu"
    | "openrouter"
    | "gemini"
    | "vertex"
    | "ollama"
    | "google"
    | "custom";
  fallback: boolean;
  error?: string;
  targetLang: string;
}

const cache = new Map<
  string,
  { text: string; at: number; source: TranslateResult["source"] }
>();
const CACHE_MS = 10 * 60_000;
type TranslationRequest = { promise: Promise<TranslateResult>; controller: AbortController; users: number };
const inFlight = new Map<string, TranslationRequest>();
let activeReadingTranslations = 0;
const readingQueue: (() => void)[] = [];

type TranslationOptions = { googleFirst?: boolean; signal?: AbortSignal };

async function readTranslation(run: () => Promise<TranslateResult>, signal: AbortSignal) {
  if (activeReadingTranslations >= 2) {
    await new Promise<void>((resolve, reject) => {
      const start = () => {
        signal.removeEventListener("abort", cancel);
        activeReadingTranslations++;
        resolve();
      };
      const cancel = () => {
        const index = readingQueue.indexOf(start);
        if (index >= 0) readingQueue.splice(index, 1);
        reject(signal.reason);
      };
      signal.addEventListener("abort", cancel, { once: true });
      readingQueue.push(start);
    });
  } else activeReadingTranslations++;
  try { signal.throwIfAborted(); return await run(); }
  finally { activeReadingTranslations--; readingQueue.shift()?.(); }
}

function joinTranslation(key: string, request: TranslationRequest, signal?: AbortSignal): Promise<TranslateResult> {
  request.users++;
  return new Promise((resolve, reject) => {
    let finished = false;
    const release = () => {
      if (finished) return false;
      finished = true;
      signal?.removeEventListener("abort", cancel);
      request.users--;
      return true;
    };
    const cancel = () => {
      if (!release()) return;
      if (!request.users) {
        if (inFlight.get(key) === request) inFlight.delete(key);
        request.controller.abort();
      }
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", cancel, { once: true });
    request.promise.then(value => { if (release()) resolve(value); }, error => { if (release()) reject(error); });
    if (signal?.aborted) cancel();
  });
}

export function getTranslationContextKey(text: string, to: string, settings: AppSettings, opts?: TranslationOptions) {
  settings = getTranslationSettings(settings);
  text = text.trim();
  to = LANG_NAME[to] ? to : "en";
  const service = settings.translateService || "auto";
  const ready = hasKey(settings);
  const google = service === "google" || (service === "auto" && !ready);
  const config = google ? null : getOpenAiCompatibleConfig(settings);
  return JSON.stringify([to, text, service, google ? "google" : settings.aiProvider,
    google ? "" : config?.model || settings.aiModel || "",
    google ? "" : config?.baseUrl || (settings.aiProvider === "ollama" ? settings.ollamaUrl : ""),
    google || ready, opts?.googleFirst && service === "auto" ? "google-first" : "", !google&&settings.aiProvider==="vertex"?[settings.vertexProjectId,settings.vertexLocation,settings.vertexCredentialId]:null]);
}

function rememberTranslation(key: string, text: string, source: TranslateResult["source"]) {
  const now = Date.now();
  for (const [oldKey, entry] of cache) if (now - entry.at >= CACHE_MS) cache.delete(oldKey);
  cache.delete(key);
  cache.set(key, { text, source, at: now });
  while (cache.size > 128) cache.delete(cache.keys().next().value!);
}

/** 校验译文是否符合用户选择的目标语言；短名称、号码和链接允许原样保留。 */
export function translationMatchesTarget(
  source: string,
  translated: string,
  targetLang: string
): boolean {
  const output = translated.trim();
  if (!output) return false;
  if (!LANG_NAME[targetLang]) return true;

  const sourceLetters = source.match(/\p{L}/gu)?.length || 0;
  if (sourceLetters < 12) return true;
  return detectMessageLanguage(output) === targetLang;
}

function hasKey(s: AppSettings) {
  return hasAiCredentials(s);
}

function stripTranslationFences(raw: string): string {
  let text = raw.trim();
  const fence = text.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  // 去掉模型爱加的引号
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

async function chatComplete(opts: {
  provider: Exclude<AppSettings["aiProvider"], "mock">;
  settings: AppSettings;
  system: string;
  user: string;
  signal?: AbortSignal;
}): Promise<string> {
  if (opts.provider === "gemini"||opts.provider==="vertex") {
    return geminiGenerate({
      apiKey: opts.settings.geminiKey,
      model: opts.settings.aiModel.trim() || undefined,
      system: opts.system,
      user: opts.user,
      temperature:0.2,
      signal: opts.signal,
      feature:"translation",
      vertex:vertexAiConfig(opts.settings),
    });
  }
  if (opts.provider === "ollama") {
    const base = opts.settings.ollamaUrl.replace(/\/$/, "");
    return trackAiRequest({provider:"ollama",model:opts.settings.aiModel.trim()||"llama3.2",endpoint:base,feature:"translation"},async observe=>{
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.settings.aiModel.trim() || "llama3.2",
        stream: false,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      }),
      signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}`);
    const data = (await readAiJson(res,observe)) as {
      message?: { content?: string };
      response?: string;
    };
    const content = data.message?.content ?? data.response;
    if (!content?.trim()) throw new Error("Ollama 空响应");
    return content;
    });
  }

  const config = getOpenAiCompatibleConfig(opts.settings);
  if (!config?.baseUrl || !config.model) {
    throw new Error("自定义提供商缺少 Base URL 或模型名");
  }

  return trackAiRequest({provider:opts.provider,model:config.model,endpoint:config.baseUrl,feature:"translation"},async observe=>{
  const res = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      ...chatCompletionOptions(opts.provider,config.model,0.2),
      ...(opts.provider === "groq" && /^openai\/gpt-oss-(20b|120b)$/.test(config.model)
        ? { reasoning_effort: "low", include_reasoning: false } : {}),
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
    }),
    signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const errBody = (await readAiJson(res,observe)) as { error?: { message?: string } };
      detail = errBody.error?.message || detail;
    } catch {
      /* ignore */
    }
    throw new Error(`${opts.provider} ${res.status}: ${detail}`);
  }
  const data = (await readAiJson(res,observe)) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content?.trim()) throw new Error(`${opts.provider} 空响应`);
  return content;
  });
}

/**
 * Google 翻译免费接口（无需 Key，非官方，仅作轻量翻译）。
 * 失败抛错，由调用方回退。
 */
async function googleTranslate(
  text: string,
  to: string,
  timeoutMs = 30_000,
  signal?: AbortSignal
): Promise<string> {
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "auto");
  url.searchParams.set("tl", to);
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", text);
  const res = await fetch(url.toString(), {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Google 翻译 ${res.status}`);
  const data = (await readAiJson(res)) as unknown[];
  const rows = data[0];
  if (!Array.isArray(rows)) throw new Error("Google 翻译响应异常");
  const out = rows
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) => (typeof row[0] === "string" ? row[0] : ""))
    .join("");
  const trimmed = out.trim();
  if (!trimmed) throw new Error("Google 翻译空结果");
  return trimmed;
}

/**
 * 把草稿译成目标语。成功则返回纯译文（可直接进输入框）。
 * 仅返回真实译文；请求失败或仅有演示提供商时返回空文本和错误，保留调用方原文。
 */
export async function translateDraftText(
  text: string,
  targetLang: Exclude<TranslateLangCode, "auto"> | string,
  settings: AppSettings,
  opts?: TranslationOptions
): Promise<TranslateResult> {
  opts?.signal?.throwIfAborted();
  const src = text.trim();
  const to = (
    LANG_NAME[targetLang] ? targetLang : "en"
  ) as Exclude<TranslateLangCode, "auto">;
  if (!src) {
    return {
      text: "",
      source: "mock",
      fallback: false,
      error: "没有可翻译的内容",
      targetLang: to,
    };
  }

  const ck = getTranslationContextKey(src, to, settings, opts);
  const hit = cache.get(ck);
  if (
    hit &&
    Date.now() - hit.at < CACHE_MS &&
    translationMatchesTarget(src, hit.text, to)
  ) {
    cache.delete(ck);
    cache.set(ck, hit);
    return {
      text: hit.text,
      source: hit.source,
      fallback: false,
      targetLang: to,
    };
  }
  if (hit) cache.delete(ck);
  const pending = inFlight.get(ck);
  if (pending) return joinTranslation(ck, pending, opts?.signal);
  const controller = new AbortController();
  const run = () => translateDraftTextUncached(src, to, settings, ck, { ...opts, signal: controller.signal });
  const request: TranslationRequest = {
    controller, users: 0,
    promise: opts?.googleFirst ? readTranslation(run, controller.signal) : run(),
  };
  inFlight.set(ck, request);
  void request.promise.then(() => { if (inFlight.get(ck) === request) inFlight.delete(ck); },
    () => { if (inFlight.get(ck) === request) inFlight.delete(ck); });
  return joinTranslation(ck, request, opts?.signal);
}

async function translateDraftTextUncached(src: string, to: string, settings: AppSettings, ck: string, opts?: TranslationOptions): Promise<TranslateResult> {
  opts?.signal?.throwIfAborted();
  settings = getTranslationSettings(settings);
  const provider = settings.aiProvider;
  const service = settings.translateService || "auto";
  const hasAiKey = hasKey(settings);

  const googleFirst = opts?.googleFirst && service === "auto";
  const useGoogle = service === "google" || (service === "auto" && (!hasAiKey || googleFirst));
  if (useGoogle) {
    try {
      const textOut = await googleTranslate(src, to, googleFirst ? 3_000 : 30_000, opts?.signal);
      opts?.signal?.throwIfAborted();
      if (!translationMatchesTarget(src, textOut, to)) {
        throw new Error(`Google 翻译未返回${LANG_NAME[to]}译文`);
      }
      rememberTranslation(ck, textOut, "google");
      return {
        text: textOut,
        source: "google",
        fallback: false,
        targetLang: to,
      };
    } catch (e) {
      opts?.signal?.throwIfAborted();
      // Reading translations fail over promptly; explicit provider choices never change service.
      if (!googleFirst || !hasAiKey) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          text: "",
          source: "google",
          fallback: true,
          error: msg,
          targetLang: to,
        };
      }
    }
  }

  if (provider === "mock" || !hasAiKey) {
    return {
      text: "",
      source: "mock",
      fallback: true,
      error: provider === "mock"
        ? "未启用翻译模型，请在“文字翻译”中配置服务或选择 Google 翻译"
        : "未配置可用的翻译服务，请在“文字翻译”中配置密钥或选择 Google 翻译",
      targetLang: to,
    };
  }

  const langName = LANG_NAME[to] || "English";
  const system = [
    "You are a professional translator for B2B WhatsApp sales chat.",
    `Translate the user's message into ${langName}.`,
    `The output language MUST be ${langName}, even when the source is in another language.`,
    "Rules:",
    "- Output ONLY the translation, no quotes, no labels, no explanation.",
    "- Keep numbers, model names, URLs, @mentions and WhatsApp formatting.",
    "- Keep a natural chat tone; do not make it more formal than the source.",
    "- If the text is already in the target language, return it unchanged.",
  ].join("\n");

  try {
    let raw = await chatComplete({
      provider: provider as Exclude<AppSettings["aiProvider"], "mock">,
      settings,
      system,
      user: `Target language: ${langName}\n<source>\n${src}\n</source>`,
      signal: opts?.signal,
    });
    opts?.signal?.throwIfAborted();
    let textOut = stripTranslationFences(raw);
    if (!textOut) throw new Error("译文为空");

    // 模型偶尔会忽略目标语言（尤其长消息）；同一提供商用更强约束重试一次。
    if (!translationMatchesTarget(src, textOut, to)) {
      raw = await chatComplete({
        provider: provider as Exclude<AppSettings["aiProvider"], "mock">,
        settings,
        system: `${system}\nIMPORTANT: Your previous answer used the wrong language. Return ${langName} only.`,
        user: `Translate ONLY into ${langName}:\n<source>\n${src}\n</source>`,
        signal: opts?.signal,
      });
      opts?.signal?.throwIfAborted();
      textOut = stripTranslationFences(raw);
    }

    // “自动”模式允许在 AI 连续返回错语言时改走已有的 Google 翻译后备。
    if (!translationMatchesTarget(src, textOut, to) && service === "auto" && !googleFirst) {
      const googleText = await googleTranslate(src, to, 30_000, opts?.signal);
      opts?.signal?.throwIfAborted();
      if (!translationMatchesTarget(src, googleText, to)) {
        throw new Error(`翻译服务未返回${langName}译文`);
      }
      rememberTranslation(ck, googleText, "google");
      return {
        text: googleText,
        source: "google",
        fallback: false,
        targetLang: to,
      };
    }
    if (!translationMatchesTarget(src, textOut, to)) {
      throw new Error(`AI 未返回${langName}译文，请重试`);
    }
    rememberTranslation(ck, textOut, provider as TranslateResult["source"]);
    return {
      text: textOut,
      source: provider as TranslateResult["source"],
      fallback: false,
      targetLang: to,
    };
  } catch (e) {
    opts?.signal?.throwIfAborted();
    const msg = e instanceof Error ? e.message : String(e);
    return {
      text: "",
      source: "mock",
      fallback: true,
      error: msg,
      targetLang: to,
    };
  }
}
