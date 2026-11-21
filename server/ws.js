import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { parseClient, tokenBucket, version } from "./protocol.js";
import { decodeInput } from "../shared/codec.js";
import { Match, matches } from "./match.js";
import { createLink } from "./link.js";

function send(socket, payload, critical = false) {
  if (socket.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount > 64 * 1024) {
    if (critical) socket.close(1013, "Slow client");
    return;
  }
  socket.send(payload instanceof ArrayBuffer ? payload : JSON.stringify({ v: version, ...payload }));
}

function bindRoom(room) {
  function roster() {
    const players = [...room.players.values()].map(({ id, name }) => ({ id, name }));
    for (const player of room.players.values()) send(player.socket, { type: "roster", players }, true);
  }
  room.on("join", roster);
  room.on("leave", roster);
  room.on("chat", message => {
    for (const player of room.players.values()) send(player.socket, { type: "chat", ...message });
  });
}

export function attachSockets(server, manager, { pingMs = 15_000, joinMs = 5000 } = {}) {
  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 1024, perMessageDeflate: false });
  const bound = new WeakSet();
  wss.on("error", error => console.error("WebSocket server:", error.message));

  wss.on("connection", (socket, request) => {
    const take = tokenBucket(32, 44);
    const link = createLink(request.url);
    const deadline = setTimeout(() => socket.close(1008, "Join timeout"), joinMs);
    let room, player;
    socket.missedPongs = 0;
    socket.on("pong", () => { socket.missedPongs = 0; });
    socket.on("error", error => console.warn("WebSocket:", error.message));
    socket.on("close", () => {
      clearTimeout(deadline);
      link.close();
      room?.leave(player.id);
    });
    socket.on("message", (bytes, binary) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (!take()) return socket.close(1008, "Rate limit");
      let message;
      try { message = binary ? decodeInput(bytes) : parseClient(bytes); } catch { message = null; }
      if (!message) return socket.close(1003, "Invalid message");
      if (!room && message.type === "join") {
        const target = manager.get(message.room);
        if (!target) return socket.close(1008, "Room unavailable");
        if (!bound.has(target)) {
          bindRoom(target);
          new Match(target, send);
          bound.add(target);
        }
        const candidate = { id: randomUUID(), name: message.name, socket, link, binary: message.binary, ack: 0, inputs: new Map() };
        if (!target.join(candidate)) return socket.close(1008, "Room full or busy");
        room = target;
        player = candidate;
        clearTimeout(deadline);
        send(socket, { type: "joined", id: player.id, replayId: room.replayId, seed: matches.get(room.id).seed }, true);
      } else if (room && message.type === "input" && binary === player.binary) {
        link.schedule(() => matches.get(room.id)?.input(player, message));
      } else if (room && message.type === "probe") {
        link.schedule(() => link.schedule(() => send(socket, message), false), false);
      } else if (room && message.type === "chat") {
        if (!room.chat(player, message.text)) send(socket, { type: "notice", text: "Журнал зайнятий. Повтори пізніше." });
      } else socket.close(1008, "Unexpected message");
    });
  });

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      if (socket.missedPongs >= 2) socket.terminate();
      else {
        socket.missedPongs++;
        socket.ping();
      }
    }
  }, pingMs).unref();
  wss.once("close", () => clearInterval(heartbeat));
  return wss;
}
