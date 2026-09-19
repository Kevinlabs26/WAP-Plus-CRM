const COMPOSER_QUIET_MS = 1200;
/**
 * 输入框仍聚焦时，即使最近一次按键已超过 COMPOSER_QUIET_MS（中文输入法选候选字/
 * 想词的停顿），也要比普通 quiet 更久才允许后台同步抢主线程，避免停顿时 sync 冲进来
 * 卡住紧接着的输入。
 */
const COMPOSER_FOCUS_HOLD_MS = 4000;

let lastInputAt = 0;

export function markComposerInput(at = Date.now()) {
  lastInputAt = at;
}

export function isComposerInputActive(
  now = Date.now(),
  quietMs = COMPOSER_QUIET_MS
) {
  return lastInputAt > 0 && now - lastInputAt < quietMs;
}

export function isComposerInputFocused() {
  return (
    typeof document !== "undefined" &&
    document.activeElement?.getAttribute("data-composer-input") === "true"
  );
}

/**
 * 后台同步让路判定：输入框聚焦且近期有输入（含输入法组合停顿）时，主线程不得被
 * ingest 抢占。页面隐藏/未聚焦/长时间没敲字时放行，避免同步被无限期卡住。
 */
export function isComposerTypingBusy(
  now = Date.now(),
  holdMs = COMPOSER_FOCUS_HOLD_MS
): boolean {
  if (!isComposerInputFocused()) return false;
  if (typeof document !== "undefined" && document.hidden) return false;
  return lastInputAt > 0 && now - lastInputAt < holdMs;
}
