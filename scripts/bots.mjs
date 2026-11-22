import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import WebSocket from "ws";
import { encodeInput } from "../shared/codec.ts";
import { DT } from "../shared/protocol.ts";

export function localOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("Use a local HTTP game server");
  }
  return url.origin;
}

export async function createRoom(origin, name) {
  const response = await fetch(localOrigin(origin) + "/api/rooms", {
    method: "POST", body: JSON.stringify({ name }), signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) throw new Error(`Room creation failed (${response.status})`);
  return response.json();
}

export function botControls(slot, seq) {
  const phase = (Math.floor(seq / 40) + slot) % 4;
  return {
    type: "input", seq,
    turn: phase === 0 ? -1 : phase === 2 ? 1 : 0,
    thrust: phase !== 3,
    fire: true,
    homing: phase === 2,
  };
}

export async function joinBot(origin, room, slot) {
  const socket = new WebSocket(localOrigin(origin).replace(/^http/, "ws") + "/ws", { handshakeTimeout: 4000 });
  socket.on("error", () => socket.terminate());
  let timer;
  try {
    await once(socket, "open", { signal: AbortSignal.timeout(5000) });
    const joined = new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error("Bot join timed out")), 4500);
      socket.once("close", () => { clearTimeout(deadline); reject(new Error("Bot join rejected")); });
      socket.on("message", (data, binary) => {
        if (!binary && JSON.parse(data.toString()).type === "joined") {
          clearTimeout(deadline);
          resolve();
        }
      });
    });
    socket.send(JSON.stringify({ v: 1, type: "join", room, name: "Bot " + slot, codec: "bin" }));
    await joined;
    let seq = 0;
    timer = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 16_384) {
        socket.send(encodeInput(botControls(slot, ++seq)));
      }
    }, Math.round(DT * 1000));
    socket.once("close", () => clearInterval(timer));
    return async () => {
      clearInterval(timer);
      if (socket.readyState === WebSocket.CLOSED) return;
      const closed = once(socket, "close", { signal: AbortSignal.timeout(3500) });
      socket.close();
      await closed.catch(() => socket.terminate());
    };
  } catch (error) {
    clearInterval(timer);
    socket.terminate();
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const origin = localOrigin(process.env.ORIGIN ?? "http://127.0.0.1:3000");
  const [count = "7", existingRoom, seconds = "300"] = process.argv.slice(2);
  const n = Number(count), duration = Number(seconds);
  if (!Number.isInteger(n) || n < 1 || n > 8 || !Number.isFinite(duration) || duration <= 0 || duration > 3600) {
    throw new Error("Usage: npm run bots -- [1..8] [room ID] [seconds up to 3600]");
  }
  const room = existingRoom ?? (await createRoom(origin, "Lab 07 bots")).id;
  const stops = [];
  const signal = new AbortController();
  process.once("SIGINT", () => signal.abort());
  try {
    for (let slot = 1; slot <= n; slot++) stops.push(await joinBot(origin, room, slot));
    console.log(`${n} bots in room ${room}. Select “Lab 07 bots” in the lobby when a slot is available.`);
    await sleep(duration * 1000, undefined, { signal: signal.signal }).catch(error => {
      if (!signal.signal.aborted) throw error;
    });
  } finally { await Promise.all(stops.map(stop => stop())); }
}
