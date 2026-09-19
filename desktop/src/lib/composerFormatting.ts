export type ComposerFormattingResult = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

/** Toggle WhatsApp's *bold* marker while keeping the useful selection/caret. */
export function toggleComposerBold(
  value: string,
  selectionStart: number,
  selectionEnd: number
): ComposerFormattingResult {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));

  if (start === end) {
    return {
      value: `${value.slice(0, start)}**${value.slice(end)}`,
      selectionStart: start + 1,
      selectionEnd: start + 1,
    };
  }

  const selected = value.slice(start, end);
  if (selected.length > 2 && selected.startsWith("*") && selected.endsWith("*")) {
    return {
      value: `${value.slice(0, start)}${selected.slice(1, -1)}${value.slice(end)}`,
      selectionStart: start,
      selectionEnd: end - 2,
    };
  }

  if (value[start - 1] === "*" && value[end] === "*") {
    return {
      value: `${value.slice(0, start - 1)}${selected}${value.slice(end + 1)}`,
      selectionStart: start - 1,
      selectionEnd: end - 1,
    };
  }

  return {
    value: `${value.slice(0, start)}*${selected}*${value.slice(end)}`,
    selectionStart: start + 1,
    selectionEnd: end + 1,
  };
}
