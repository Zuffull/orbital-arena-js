import { performance } from "node:perf_hooks";
import { matches } from "./match.ts";
import type { RoomManager } from "./rooms.ts";

let messages = 0, bytes = 0, rejected = 0;
let oldMessages = 0, oldBytes = 0;
let last = performance.now();
let lastLoop = performance.eventLoopUtilization();
let messagesPerSecond = 0, bytesPerSecond = 0, eventLoop = 0;

export const noteTraffic = (size: number) => { messages++; bytes += size; };
export const noteRejection = () => { rejected++; };

export function startMetrics() {
  return setInterval(() => {
    const now = performance.now(), seconds = (now - last) / 1000;
    messagesPerSecond = (messages - oldMessages) / seconds;
    bytesPerSecond = (bytes - oldBytes) / seconds;
    const current = performance.eventLoopUtilization();
    eventLoop = performance.eventLoopUtilization(current, lastLoop).utilization;
    last = now;
    oldMessages = messages;
    oldBytes = bytes;
    lastLoop = current;
  }, 1000).unref();
}

export function metrics(manager: RoomManager): string {
  const memory = process.memoryUsage(), counts = manager.counts();
  const timings = [...matches.values()].map(match => match.stats());
  const lines = {
    orbital_players: counts.players,
    orbital_rooms: counts.rooms,
    orbital_ws_messages_total: messages,
    orbital_ws_payload_bytes_total: bytes,
    orbital_ws_rejected_total: rejected,
    orbital_ws_messages_per_second: messagesPerSecond,
    orbital_ws_payload_bytes_per_second: bytesPerSecond,
    orbital_step_p99_seconds: Math.max(0, ...timings.map(s => s.p99TickMs)) / 1000,
    orbital_event_loop_utilization_ratio: eventLoop,
    process_resident_memory_bytes: memory.rss,
    orbital_heap_used_bytes: memory.heapUsed,
  };
  return Object.entries(lines).map(([name, value]) =>
    `# TYPE ${name} ${name.endsWith("_total") ? "counter" : "gauge"}\n${name} ${value}\n`).join("");
}
