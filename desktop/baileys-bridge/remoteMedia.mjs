import dns from "node:dns/promises";
import https from "node:https";
import { isIP } from "node:net";
import { readBoundedStream } from "./httpUtil.mjs";

const denied = () => Object.assign(new Error("媒体地址必须是公共 HTTPS 地址"), { status: 400 });

export function isPublicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) === 6) {
    const [first, second] = address.split(":").map(part => parseInt(part || "0", 16));
    // Global unicast only; exclude transition, protocol and documentation space.
    return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 && first !== 0x3ffe
      && !(first === 0x2001 && (second < 0x200 || second === 0xdb8))
      && !(first === 0x3fff && second < 0x1000);
  }
  return false;
}

export function validateRemoteMediaUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw denied(); }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")
    || !host || host === "localhost" || host.endsWith(".localhost")
    || (isIP(host) && !isPublicAddress(host))) throw denied();
  return url;
}

async function publicHost(host, signal) {
  signal.throwIfAborted();
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }]
    : await new Promise((resolve, reject) => {
      const aborted = () => reject(signal.reason);
      signal.addEventListener("abort", aborted, { once: true });
      dns.lookup(host, { all: true, verbatim: true }).then(resolve, reject)
        .finally(() => signal.removeEventListener("abort", aborted));
    });
  signal.throwIfAborted();
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw denied();
  return addresses.find(item => item.family === 4) || addresses[0];
}

/** Resolve once per hop and pin that address to the actual TLS connection. */
export async function downloadRemoteMedia(raw, maxBytes, headers = {}) {
  const signal = AbortSignal.timeout(30_000);
  let url = validateRemoteMediaUrl(raw);
  for (let hop = 0; hop <= 5; hop++) {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const address = await publicHost(host, signal);
    const response = await new Promise((resolve, reject) => {
      const request = https.request(url, {
        method: "GET", agent: false, signal, headers,
        servername: isIP(host) ? undefined : host,
        lookup: (_host, options, callback) => options.all
          ? callback(null, [address]) : callback(null, address.address, address.family),
      }, resolve);
      request.on("error", reject);
      request.end();
    });
    try {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        if (!response.headers.location || hop === 5) throw denied();
        url = validateRemoteMediaUrl(new URL(response.headers.location, url));
        continue;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Object.assign(new Error("媒体服务器拒绝下载"), { status: response.statusCode });
      }
      if (Number(response.headers["content-length"]) > maxBytes) throw Object.assign(new Error("media too large"), { status: 413 });
      return {
        buffer: await readBoundedStream(response, maxBytes),
        contentType: String(response.headers["content-type"] || "application/octet-stream").split(";")[0],
      };
    } finally { response.destroy(); }
  }
  throw denied();
}
