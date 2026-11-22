import assert from "node:assert/strict";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import WebSocket from "ws";

const base = process.env.ORIGIN ?? "http://127.0.0.1:38661";
const allowed = { origin: base };
const url = base.replace(/^http/, "ws") + "/ws";
const sockets = [];
async function join(id, name) {
  const socket = new WebSocket(url, allowed);
  sockets.push(socket);
  await once(socket, "open", { signal: AbortSignal.timeout(4000) });
  const joined = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("join timeout")), 5000);
    socket.on("message", (payload, binary) => {
      if (!binary && JSON.parse(payload).type === "joined") { clearTimeout(timer); resolve(); }
    });
  });
  socket.send(JSON.stringify({ v: 1, type: "join", room: id, name }));
  await joined;
  return socket;
}

async function denied(origin, status) {
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { origin, handshakeTimeout: 4000 });
    socket.once("unexpected-response", (_, response) => {
      response.resume();
      try { assert.equal(response.statusCode, status); resolve(); } catch (error) { reject(error); }
    });
    socket.once("error", reject);
    socket.once("open", () => { socket.close(); reject(new Error("Unexpected upgrade")); });
  });
}

try {
  const health = await (await fetch(base + "/health")).json();
  assert.equal(health.sha, process.env.EXPECT_SHA);
  assert.equal((await fetch(base + "/ready")).status, 200);
  await denied("https://wrong.example", 403);
  const create = name => fetch(base + "/api/rooms", { method: "POST", body: JSON.stringify({ name }) }).then(r => r.json());
  const [roomA, roomB] = await Promise.all([create("Lifecycle"), create("Isolated")]);
  const a = await join(roomA.id, "Alpha"), b = await join(roomA.id, "Beta"), other = await join(roomB.id, "Gamma");
  const roster = new Promise(resolve => {
    a.on("message", (payload, binary) => {
      if (!binary && JSON.parse(payload).type === "roster" && JSON.parse(payload).players.length === 1) resolve();
    });
  });
  b.terminate();
  await Promise.race([roster, sleep(3000).then(() => { throw new Error("Lost player stayed in roster"); })]);
  const malformed = await join(roomA.id, "Malformed");
  const closed = once(malformed, "close", { signal: AbortSignal.timeout(4000) });
  malformed.send("not JSON");
  assert.equal((await closed)[0], 1003);
  const ticks = await once(other, "message", { signal: AbortSignal.timeout(4000) });
  assert.equal(ticks[1], true);
  const metrics = await (await fetch(base + "/metrics")).text();
  assert.match(metrics, /orbital_players 2/);
  assert.match(metrics, /orbital_ws_rejected_total [2-9]/);
  const manifest = await (await fetch(base + "/manifest.webmanifest")).json();
  assert.equal(manifest.display, "standalone");
  const shutdown = await new Promise((resolve, reject) => {
    let notice = false;
    let duringDrain;
    const timer = setTimeout(() => reject(new Error("Missing shutdown")), 20_000);
    a.on("message", (payload, binary) => {
      if (!binary && JSON.parse(payload).type === "shutdown") {
        notice = true;
        duringDrain = Promise.all([fetch(base + "/ready"), fetch(base + "/health")]).then(([ready, live]) => {
          assert.equal(ready.status, 503);
          assert.equal(live.status, 200);
        });
        void duringDrain.catch(reject);
      }
    });
    a.on("close", code => {
      clearTimeout(timer);
      try { assert.equal(code, 1001); assert.equal(notice, true); void duringDrain.then(() => resolve(code), reject); } catch (error) { reject(error); }
    });
    console.log("READY_FOR_STOP");
  });
  console.log("Container shutdown notice and close code", shutdown);
} finally {
  for (const socket of sockets) socket.terminate();
}
