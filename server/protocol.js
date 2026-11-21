import { readInput, VERSION, isUint32 } from "../shared/protocol.js";

export const version = VERSION;

export function boundedText(value, max) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;
}

export function parseClient(bytes) {
  let msg;
  try { msg = JSON.parse(bytes.toString("utf8")); }
  catch { return null; }
  if (msg?.v !== version) return null;
  if (msg.type === "join" && typeof msg.room === "string" && /^[a-f0-9-]{36}$/.test(msg.room) && boundedText(msg.name, 24)) {
    if (msg.codec !== undefined && !["bin", "json"].includes(msg.codec)) return null;
    return { type: "join", room: msg.room, name: msg.name.trim(), binary: msg.codec !== "json" };
  }
  if (msg.type === "input") return readInput(msg);
  if (msg.type === "probe" && isUint32(msg.nonce)) return { type: "probe", nonce: msg.nonce };
  if (msg.type === "chat" && boundedText(msg.text, 240)) return { type: "chat", text: msg.text.trim() };
  return null;
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
