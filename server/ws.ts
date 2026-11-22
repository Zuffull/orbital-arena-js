import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { parseClient, rawBuffer, tokenBucket } from "./protocol.ts";
import { unreachable, VERSION, ZERO_SEQ, type ClientMessage, type Input, type ServerMessage } from "../shared/protocol.ts";
import { isIP } from "node:net";
import type { IncomingMessage, Server } from "node:http";
import type { Player, Room, RoomManager } from "./rooms.ts";
import { decodeInput } from "../shared/codec.ts";
import { Match, matches } from "./match.ts";
import { createLink } from "./link.ts";
import type { readConfig } from "./config.ts";
import { log } from "./log.ts";
import { noteRejection, noteTraffic } from "./metrics.ts";

type Policy = Pick<ReturnType<typeof readConfig>, "deployed" | "origins" | "maxIpConnections" | "trustProxy">;

export function acceptOrigin(origin: string | undefined, policy: Policy) {
  if (!origin) return !policy.deployed && policy.origins.size === 0;
  if (policy.origins.has(origin)) return true;
  if (policy.deployed || policy.origins.size) return false;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && url.origin === origin;
  } catch { return false; }
}

export function clientAddress(request: IncomingMessage, trustProxy: boolean) {
  const forwarded = request.headers["x-forwarded-for"];
  const candidate = typeof forwarded === "string" ? forwarded.split(",").at(-1)?.trim() : undefined;
  return trustProxy && candidate && isIP(candidate) ? candidate : request.socket.remoteAddress ?? "unknown";
}

type Message = { [K in ServerMessage["type"]]: Omit<Extract<ServerMessage, { type: K }>, "v"> }[ServerMessage["type"]];

export function send(socket: WebSocket, payload: ArrayBuffer | Message, critical = false) {
  if (socket.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount > 64 * 1024) {
    if (critical) socket.close(1013, "Slow client");
    return;
  }
  const encoded = payload instanceof ArrayBuffer ? payload : JSON.stringify({ v: VERSION, ...payload });
  socket.send(encoded);
  noteTraffic(typeof encoded === "string" ? Buffer.byteLength(encoded) : encoded.byteLength);
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

export function attachSockets(server: Server, manager: RoomManager, policy: Policy, ready: () => boolean) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  const counts = new Map<string, number>();
  server.on("upgrade", (request, socket, head) => {
    const address = clientAddress(request, policy.trustProxy);
    const count = counts.get(address) ?? 0;
    const status = !ready() ? "503 Service Unavailable"
      : request.url?.split("?")[0] !== "/ws" ? "404 Not Found"
      : !acceptOrigin(request.headers.origin, policy) ? "403 Forbidden"
      : count >= policy.maxIpConnections ? "429 Too Many Requests" : null;
    if (status) {
      noteRejection();
      socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      return;
    }
    wss.handleUpgrade(request, socket, head, client => {
      counts.set(address, count + 1);
      client.once("close", () => {
        const remaining = (counts.get(address) ?? 1) - 1;
        if (remaining > 0) counts.set(address, remaining);
        else counts.delete(address);
      });
      wss.emit("connection", client, request);
    });
  });
  const bound = new WeakSet<Room>();
  const missedPongs = new WeakMap<WebSocket, number>();
  wss.on("error", error => log.error({ err: error }, "WebSocket server error"));

  wss.on("connection", (socket, request) => {
    const take = tokenBucket(32, 44);
    const link = createLink(policy.deployed ? undefined : request.url);
    const deadline = setTimeout(() => socket.close(1008, "Join timeout"), 5000);
    let session: { room: Room; player: Player } | undefined;
    missedPongs.set(socket, 0);
    socket.on("pong", () => { missedPongs.set(socket, 0); });
    socket.on("error", error => log.warn({ err: error, roomId: session?.room.id, playerId: session?.player.id }, "WebSocket error"));
    socket.on("close", () => {
      clearTimeout(deadline);
      link.close();
      if (session) session.room.leave(session.player.id);
    });
    socket.on("message", (bytes, binary) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (!ready()) return socket.close(1001, "Server stopping");
      if (!take()) {
        noteRejection();
        return socket.close(1008, "Rate limit");
      }
      const raw = rawBuffer(bytes);
      noteTraffic(raw.length);
      let message: ClientMessage | Input | null;
      try {
        message = binary ? decodeInput(raw) : parseClient(raw);
      } catch {
        message = null;
      }
      if (!message) {
        noteRejection();
        log.warn({ roomId: session?.room.id, playerId: session?.player.id }, "Invalid message");
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
            send(socket, { type: "notice", text: "Р–СѓСЂРЅР°Р» Р·Р°Р№РЅСЏС‚РёР№. РЎРїСЂРѕР±СѓР№С‚Рµ С‰Рµ СЂР°Р·." });
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
  }, 15_000).unref();
  wss.once("close", () => clearInterval(heartbeat));
  return wss;
}
