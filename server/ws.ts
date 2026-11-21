import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { parseClient, rawBuffer, tokenBucket } from "./protocol.ts";
import { unreachable, VERSION, ZERO_SEQ, type ClientMessage, type Input, type ServerMessage } from "../shared/protocol.ts";
import type { Server } from "node:http";
import type { Player, Room, RoomManager } from "./rooms.ts";
import { decodeInput } from "../shared/codec.ts";
import { Match, matches } from "./match.ts";
import { createLink } from "./link.ts";

type Message = { [K in ServerMessage["type"]]: Omit<Extract<ServerMessage, { type: K }>, "v"> }[ServerMessage["type"]];

export function send(socket: WebSocket, payload: ArrayBuffer | Message, critical = false) {
  if (socket.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount > 64 * 1024) {
    if (critical) socket.close(1013, "Slow client");
    return;
  }
  socket.send(payload instanceof ArrayBuffer ? payload : JSON.stringify({ v: VERSION, ...payload }));
}

function bindRoom(room: Room) {
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

export function attachSockets(server: Server, manager: RoomManager, { pingMs = 15_000, joinMs = 5000 } = {}) {
  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 1024, perMessageDeflate: false });
  const bound = new WeakSet<Room>();
  const missedPongs = new WeakMap<WebSocket, number>();
  wss.on("error", error => console.error("WebSocket server:", error.message));

  wss.on("connection", (socket, request) => {
    const take = tokenBucket(32, 44);
    const link = createLink(request.url);
    const deadline = setTimeout(() => socket.close(1008, "Join timeout"), joinMs);
    let session: { room: Room; player: Player } | undefined;
    missedPongs.set(socket, 0);
    socket.on("pong", () => { missedPongs.set(socket, 0); });
    socket.on("error", error => console.warn("WebSocket:", error.message));
    socket.on("close", () => {
      clearTimeout(deadline);
      link.close();
      if (session) session.room.leave(session.player.id);
    });
    socket.on("message", (bytes, binary) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (!take()) return socket.close(1008, "Rate limit");
      let message: ClientMessage | Input | null;
      try {
        message = binary ? decodeInput(rawBuffer(bytes)) : parseClient(bytes);
      } catch {
        message = null;
      }
      if (!message) {
        console.warn("WebSocket: invalid message");
        return socket.close(1003, "Invalid message");
      }
      const current = session;
      switch (message.type) {
        case "join": {
          if (current) break;
          const room = manager.get(message.room);
          if (!room) return socket.close(1008, "Room unavailable");
          let match = matches.get(room.id);
          if (!bound.has(room) || !match) {
            bindRoom(room);
            match = new Match(room, send);
            bound.add(room);
          }
          const player: Player = {
            id: randomUUID(), name: message.name, socket, link, binary: message.codec !== "json",
            ack: ZERO_SEQ, inputs: new Map(),
          };
          if (!room.join(player)) return socket.close(1008, "Room full or busy");
          session = { room, player };
          clearTimeout(deadline);
          send(socket, { type: "joined", id: player.id, replayId: room.replayId, seed: match.seed }, true);
          return;
        }
        case "input":
          if (!current || binary !== current.player.binary) break;
          link.schedule(() => matches.get(current.room.id)?.input(current.player, message));
          return;
        case "probe":
          if (!current) break;
          link.schedule(() => link.schedule(() => send(socket, message), false), false);
          return;
        case "chat":
          if (!current) break;
          if (!current.room.chat(current.player, message.text)) {
            send(socket, { type: "notice", text: "Журнал зайнятий. Спробуйте ще раз." });
          }
          return;
        default: return unreachable(message);
      }
      socket.close(1008, "Unexpected message");
    });
  });

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      const missed = missedPongs.get(socket) ?? 0;
      if (missed >= 2) socket.terminate();
      else {
        missedPongs.set(socket, missed + 1);
        socket.ping();
      }
    }
  }, pingMs).unref();
  wss.once("close", () => clearInterval(heartbeat));
  return wss;
}
