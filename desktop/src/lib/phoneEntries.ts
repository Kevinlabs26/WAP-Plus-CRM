/** 一行或一个逗号项视为一个号码；允许号码内部包含空格、横线和括号。 */
export function parsePhoneEntries(raw: string): string[] {
  return [
    ...new Set(
      String(raw || "")
        .split(/\r?\n|[,;，；]+/u)
        .map((entry) => entry.replace(/\D/g, ""))
        .filter((digits) => digits.length >= 7 && digits.length <= 15)
    ),
  ];
}
