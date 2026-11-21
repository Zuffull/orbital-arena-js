import { parseClientMessage } from "../shared/protocol.ts";
import type { RawData } from "ws";

export function rawBuffer(bytes: RawData): Buffer {
  if (Array.isArray(bytes)) return Buffer.concat(bytes);
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
}

export function parseClient(bytes: RawData) {
  try {
    const value: unknown = JSON.parse(rawBuffer(bytes).toString("utf8"));
    return parseClientMessage(value);
  } catch {
    return null;
  }
}

export function tokenBucket(burst = 12, rate = 8) {
  let tokens = burst;
  let last = performance.now();
  return () => {
    const now = performance.now();
    tokens = Math.min(burst, tokens + (now - last) * rate / 1000);
    last = now;
    if (tokens < 1) return false;
    tokens--;
    return true;
  };
}
