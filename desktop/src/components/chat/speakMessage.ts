/**
 * 消息朗读（WebView2 / 系统 speechSynthesis）。
 * 零依赖零网络：语音由操作系统 TTS 引擎提供，离线可用。
 * 语言探测：文字系统直判（中/日/韩/俄/阿），拉丁语系按停用词+变音符打分。
 */
let speakingToken = 0;

export const SPEECH_LANG_OPTIONS: { code: string; label: string }[] = [
  { code: "zh-CN", label: "中文" },
  { code: "en-US", label: "English" },
  { code: "fr-FR", label: "Français" },
  { code: "es-ES", label: "Español" },
  { code: "pt-BR", label: "Português" },
  { code: "de-DE", label: "Deutsch" },
  { code: "it-IT", label: "Italiano" },
  { code: "ru-RU", label: "Русский" },
  { code: "ar-SA", label: "العربية" },
  { code: "ja-JP", label: "日本語" },
  { code: "ko-KR", label: "한국어" },
];

type LangProbe = {
  code: string;
  /** 命中一个词加 1 分 */
  words: string[];
  /** 出现特征变音符额外加分 */
  bonus?: RegExp;
};

const LATIN_PROBES: LangProbe[] = [
  {
    code: "fr-FR",
    bonus: /[àâçéèêëîïôùûœ]/i,
    words: ["le", "la", "les", "des", "une", "est", "et", "vous", "je", "ne",
      "pas", "pour", "avec", "dans", "sur", "que", "qui", "au", "aux", "ce",
      "cette", "mais", "plus", "par", "nous", "ils", "elle", "être", "avoir",
      "bonjour", "merci", "s'il", "c'est", "d'un", "d'une"],
  },
  {
    code: "es-ES",
    bonus: /[ñ¿¡]/i,
    words: ["el", "los", "las", "una", "está", "son", "y", "que", "en", "por",
      "con", "para", "más", "se", "lo", "su", "como", "pero", "si", "ya",
      "muy", "hola", "gracias", "es"],
  },
  {
    code: "pt-BR",
    bonus: /[ãõâê]/i,
    words: ["os", "as", "um", "uma", "é", "e", "de", "que", "em", "por",
      "com", "não", "mais", "se", "dos", "das", "para", "como", "também",
      "obrigado", "você"],
  },
  {
    code: "de-DE",
    bonus: /[äöüß]/i,
    words: ["der", "die", "das", "und", "ist", "ein", "eine", "nicht", "mit",
      "auf", "für", "den", "dem", "sich", "auch", "aber", "zu", "von", "im",
      "danke"],
  },
  {
    code: "it-IT",
    bonus: /[àèìòù]/i,
    words: ["il", "lo", "gli", "un", "una", "è", "che", "di", "in", "con",
      "non", "per", "sono", "più", "come", "della", "degli", "grazie"],
  },
  {
    code: "en-US",
    words: ["the", "is", "are", "was", "you", "and", "of", "to", "in",
      "that", "this", "it", "with", "for", "on", "not", "have", "hello",
      "thanks", "don't", "i'm"],
  },
];

/** 返回 BCP47 语言标签 */
export function detectTextLanguage(text: string): string {
  const t = text.slice(0, 600);
  // 文字系统直判（优先级高于任何拉丁猜测）
  if(/[\u3040-\u30ff]/.test(t)) return "ja-JP";
  if(/[\u4e00-\u9fff]/.test(t)) return "zh-CN";
  if(/[\uac00-\ud7af]/.test(t)) return "ko-KR";
  if(/[\u0400-\u04ff]/.test(t)) return "ru-RU";
  if(/[\u0600-\u06ff]/.test(t)) return "ar-SA";

  const tokens = t.toLowerCase().match(/[a-zà-ÿ'’]+/g) ?? [];
  if (!tokens.length) return navigator.language || "en-US";
  const tokenSet = new Map<string, number>();
  for (const w of tokens) tokenSet.set(w, (tokenSet.get(w) ?? 0) + 1);

  let bestCode = "";
  let bestScore = 0;
  for (const probe of LATIN_PROBES) {
    let hits = 0;
    for (const [word, count] of tokenSet) {
      if (probe.words.includes(word)) hits += count;
    }
    let score = hits / tokens.length;
    if (probe.bonus?.test(t)) score += 0.12;
    if (score > bestScore) {
      bestScore = score;
      bestCode = probe.code;
    }
  }
  // 得分太低说明可能是缩写/混合内容，交给系统语言兜底
  if (bestScore < 0.08) return navigator.language || "en-US";
  return bestCode;
}

// WebView2 下 getVoices 可能异步就绪：预热缓存并监听变化
let voicesCache: SpeechSynthesisVoice[] = [];
try {
  voicesCache = window.speechSynthesis?.getVoices() ?? [];
  window.speechSynthesis?.addEventListener?.("voiceschanged", () => {
    voicesCache = window.speechSynthesis?.getVoices() ?? [];
  });
} catch {
  /* ignore */
}

function refreshVoices(): SpeechSynthesisVoice[] {
  try {
    const fresh = window.speechSynthesis?.getVoices() ?? [];
    if (fresh.length) voicesCache = fresh;
  } catch {
    /* ignore */
  }
  return voicesCache;
}

/** 为目标语言挑最合适的已安装音色：精确匹配 > 主子码前缀匹配 */
function pickVoiceFor(lang: string): SpeechSynthesisVoice | undefined {
  const voices = refreshVoices();
  const target = lang.toLowerCase();
  const prefix = target.slice(0, 2);
  return (
    voices.find((v) => v.lang?.toLowerCase() === target) ??
    voices.find((v) => v.lang?.toLowerCase().replace("_", "-").startsWith(prefix))
  );
}

export function isSpeechActive(): boolean {
  return typeof window !== "undefined" && window.speechSynthesis?.speaking === true;
}

export function stopSpeaking(): void {
  speakingToken += 1;
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
}

export type SpeakResult = {
  started: boolean;
  /** 非空时给用户看一句提醒（例如缺法语语音包） */
  notice?: string;
  /** 实际选中的系统音色名，便于诊断「为什么读了英文」 */
  voiceLabel?: string;
};

/** 开始朗读；started=false 表示文本为空或运行环境没有 TTS 能力 */
export function speakMessageText(
  text: string,
  opts?: { lang?: string; onDone?: () => void },
): SpeakResult {
  const onDone = opts?.onDone;
  const synth = window.speechSynthesis;
  const trimmed = text.trim();
  if (!synth || !trimmed) return { started: false };
  stopSpeaking();
  // 联系人手动指定 > 文本自动探测
  const lang = opts?.lang || detectTextLanguage(trimmed);
  // 关键：WebView2 光设 utterance.lang 不一定切换音色，必须显式指定 .voice
  const voice = pickVoiceFor(lang);
  const notice = voice
    ? undefined
    : `系统没有 ${lang} 音色，只能用默认音色硬读（会变成英文腔）。请到 Windows 设置 → 时间和语言 → 语音 → 添加语音，装好后重启本应用。`;
  const token = speakingToken;
  // 超长消息分段朗读：部分系统引擎对单条 utterance 有长度上限
  const chunks = trimmed.length > 220
    ? trimmed.match(/[^。！？.!?!\n]+[。！？.!?]?/g)?.slice(0, 40) ?? [trimmed]
    : [trimmed];
  synth.cancel();
  for (const chunk of chunks) {
    const utterance = new SpeechSynthesisUtterance(chunk.trim());
    utterance.lang = lang;
    if (voice) utterance.voice = voice;
    utterance.rate = 1;
    utterance.onend = () => {
      if (token === speakingToken) onDone?.();
    };
    utterance.onerror = () => {
      if (token === speakingToken) onDone?.();
    };
    synth.speak(utterance);
  }
  return { started: true, notice, voiceLabel: voice?.name ?? "系统默认音色" };
}
