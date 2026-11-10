import { deserialize } from "node:v8";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const HEADER = "WAP-RAW-JSON-1\n";
const arrays = { Uint8Array, Int8Array, Uint8ClampedArray, Uint16Array, Int16Array,
  Uint32Array, Int32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array, DataView };

export function encodeRawMessage(message) {
  const json = JSON.stringify(message, function (key, value) {
    const original = this[key];
    if (typeof original === "bigint") return { __wapBigInt: String(original) };
    if (ArrayBuffer.isView(original)) return {
      __wapBytes: Buffer.from(original.buffer, original.byteOffset, original.byteLength).toString("base64"),
      kind: Buffer.isBuffer(original) ? "Buffer" : original.constructor.name,
    };
    return value;
  });
  return Buffer.from(HEADER + json, "utf8");
}

export function decodeRawMessage(data) {
  if (!data.subarray(0, HEADER.length).equals(Buffer.from(HEADER))) return deserialize(data);
  return JSON.parse(data.toString("utf8", HEADER.length), (_key, value) => {
    if (!value || typeof value !== "object") return value;
    if (Object.keys(value).length === 1 && typeof value.__wapBigInt === "string") return BigInt(value.__wapBigInt);
    if (Object.keys(value).length !== 2 || typeof value.__wapBytes !== "string") return value;
    const bytes = Buffer.from(value.__wapBytes, "base64");
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    if (value.kind === "Buffer") return Buffer.from(buffer);
    if (Object.hasOwn(arrays, value.kind)) return new arrays[value.kind](buffer);
    throw new Error("Unsupported protocol byte array");
  });
}

/** One-time migration of caches written by the other runtime; never overwrite an unreadable file. */
export async function decodeLegacyRawMessage(data) {
  const runtime = process.versions.bun ? "node" : fileURLToPath(new URL(
    `../node_modules/bun/bin/${process.platform === "win32" ? "bun.exe" : "bun"}`, import.meta.url));
  const script = `const {deserialize}=require('node:v8');const {readFileSync}=require('node:fs');
    const HEADER=${JSON.stringify(HEADER)};const encodeRawMessage=${encodeRawMessage.toString()};
    process.stdout.write(encodeRawMessage(deserialize(readFileSync(0))));`;
  const encoded = await new Promise((resolve, reject) => {
    const child = execFile(runtime, ["-e", script], { windowsHide: true, timeout: 5000,
      maxBuffer: 8 * 1024 * 1024, encoding: "buffer" }, (error, output) => error ? reject(error) : resolve(output));
    child.stdin.on("error", reject);
    child.stdin.end(data);
  });
  return decodeRawMessage(encoded);
}
