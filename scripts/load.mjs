import { setTimeout as sleep } from "node:timers/promises";
import { writeFile } from "node:fs/promises";
import { createRoom, joinBot, localOrigin } from "./bots.mjs";

const origin = localOrigin(process.env.ORIGIN ?? "http://127.0.0.1:3000");
const rows = [];
for (const n of [8, 32, 64, 128]) {
  const stops = [], rooms = [];
  try {
    for (let start = 0; start < n; start += 8) {
      const room = await createRoom(origin, "Load " + start);
      rooms.push(room.id);
      for (let i = 0; i < 8; i++) stops.push(await joinBot(origin, room.id, start + i + 1));
    }
    await sleep(8500);
    const response = await fetch(origin + "/api/stats", { signal: AbortSignal.timeout(4000) });
    const stats = (await response.json()).filter(match => rooms.includes(match.room));
    if (stats.length !== rooms.length) throw new Error("Some load-test rooms are unavailable");
    const max = key => Math.max(...stats.map(match => match[key]));
    rows.push({ clients: n, rooms: rooms.length, p99: max("p99TickMs"), max: max("maxTickMs"),
      meanPhysics: max("meanPhysicsMs"), meanTick: max("meanTickMs"), jitter: max("maxJitterMs") });
  } finally { await Promise.all(stops.map(stop => stop())); }
}
console.table(rows);
const exceed = rows.find(row => row.max > 33);
console.log(exceed ? `First sampled tick over 33 ms: ${exceed.clients} clients` : "No sampled tick exceeded 33 ms through 128 clients.");
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(rows, null, 2) + "\n");
