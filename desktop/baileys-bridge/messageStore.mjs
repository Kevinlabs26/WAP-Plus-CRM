import { serialize } from "node:v8";

/** Bun serializes an entire backing buffer even for a 32-byte protobuf view. */
export function detachMessageBuffers(value, seen = new WeakMap()) {
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  if (ArrayBuffer.isView(value)) {
    const buffer = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    const copy = Buffer.isBuffer(value) ? Buffer.from(buffer) : new value.constructor(buffer);
    seen.set(value, copy);
    return copy;
  }
  if (value instanceof ArrayBuffer || value instanceof Date) return value;
  const copy = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
  seen.set(value, copy);
  for (const key of Object.keys(value)) copy[key] = detachMessageBuffers(value[key], seen);
  return copy;
}

/**
 * Runtime-only message cache. The desktop SQLite store owns history; this map
 * only needs to retain a bounded window for snapshots and retry lookups.
 */
export class BoundedMessageMap extends Map {
  constructor(maxEntries = 20_000, maxBytes = Infinity) {
    super();
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError("maxEntries must be a positive integer");
    }
    if (!(maxBytes > 0)) throw new RangeError("maxBytes must be positive");
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.entryBytes = new Map();
    this.totalBytes = 0;
  }

  set(key, value) {
    const bytes = Number.isFinite(this.maxBytes) ? serialize(value).byteLength : 0;
    this.delete(key);
    if (bytes > this.maxBytes) return this;
    super.set(key, value);
    if (bytes) this.entryBytes.set(key, bytes);
    this.totalBytes += bytes;
    while (this.size > this.maxEntries || this.totalBytes > this.maxBytes) {
      this.delete(this.keys().next().value);
    }
    return this;
  }

  delete(key) {
    this.totalBytes -= this.entryBytes.get(key) || 0;
    this.entryBytes.delete(key);
    return super.delete(key);
  }

  clear() {
    super.clear();
    this.entryBytes.clear();
    this.totalBytes = 0;
  }
}
