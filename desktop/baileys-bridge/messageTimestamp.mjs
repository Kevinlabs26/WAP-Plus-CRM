/** Accept live protobuf Long values and their JSON/disk representations. */
export function messageTimestampMs(value, fallback = Date.now()) {
  let numeric;
  try {
    if (typeof value === "number" || typeof value === "bigint") numeric = Number(value);
    else if (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value)) numeric = Number(value);
    else if (typeof value?.toNumber === "function") numeric = value.toNumber();
    else if (Number.isInteger(value?.low) && Number.isInteger(value?.high)) numeric = (value.high >>> 0) * 4294967296 + (value.low >>> 0);
  } catch { return fallback; }
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  const ms = numeric < 1e12 ? numeric * 1000 : numeric;
  return Number.isFinite(new Date(ms).getTime()) ? ms : fallback;
}
