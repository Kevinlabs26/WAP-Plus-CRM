const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;

export const isMac = /Macintosh/i.test(userAgent);
export const isWindows = /Windows/i.test(userAgent);
