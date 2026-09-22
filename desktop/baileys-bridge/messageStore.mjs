/**
 * Runtime-only message cache. The desktop SQLite store owns history; this map
 * only needs to retain a bounded window for snapshots and retry lookups.
 */
export class BoundedMessageMap extends Map {
  constructor(maxEntries = 20_000) {
    super();
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError("maxEntries must be a positive integer");
    }
    this.maxEntries = maxEntries;
  }

  set(key, value) {
    if (this.has(key)) super.delete(key);
    super.set(key, value);
    while (this.size > this.maxEntries) {
      super.delete(this.keys().next().value);
    }
    return this;
  }
}
