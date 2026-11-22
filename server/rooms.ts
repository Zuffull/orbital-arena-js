import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { log } from "./log.ts";
import type { WebSocket } from "ws";
import type { Input, Seq } from "../shared/protocol.ts";
import type { createLink } from "./link.ts";

export interface Player {
  id: string;
  name: string;
  socket: WebSocket;
  link: ReturnType<typeof createLink>;
  binary: boolean;
  ack: Seq;
  inputs: Map<Seq, Input>;
}

type RecordEvents = {
  join: [{ id: string; name: string }];
  leave: [{ id: string }];
  chat: [{ id: string; name: string; text: string }];
};
type RoomEvents = RecordEvents & { empty: []; close: []; error: [Error] };

export class Room extends EventEmitter<RoomEvents> {
  id = randomUUID();
  players = new Map<string, Player>();
  name: string;
  replayId: string;
  logDone: Promise<void>;
  #log;

  private readonly maximum: number;

  constructor(name: string, logDir: string, maximum = 8) {
    super();
    this.maximum = maximum;
    this.name = name;
    this.replayId = this.id + "-" + Date.now();
    this.#log = new Transform({
      writableObjectMode: true,
      transform(record: unknown, _encoding, next) {
        next(null, JSON.stringify(record) + "\n");
      },
    });
    this.on("error", error => log.error({ err: error, roomId: this.id }, "Room log failed"));
    this.logDone = pipeline(this.#log, createWriteStream(join(logDir, this.replayId + ".ndjson")))
      .catch((error: unknown) => { this.emit("error", error instanceof Error ? error : new Error(String(error))); });
  }

  #record<K extends keyof RecordEvents>(type: K, ...args: RecordEvents[K]) {
    const [data] = args;
    if (!this.#log.destroyed) this.#log.write({ t: Date.now(), type, ...data });
    log.info({ roomId: this.id, playerId: data.id, event: type }, "Room event");
  }

  join(player: Player) {
    if (this.players.size >= this.maximum || this.#log.writableLength >= 224) return false;
    this.players.set(player.id, player);
    const event = { id: player.id, name: player.name };
    this.#record("join", event);
    this.emit("join", event);
    return true;
  }

  leave(id: string) {
    if (!this.players.delete(id)) return;
    const event = { id };
    this.#record("leave", event);
    this.emit("leave", event);
    if (!this.players.size) this.emit("empty");
  }

  chat(player: Player, text: string) {
    if (this.#log.destroyed || this.#log.writableLength >= 224) return false;
    const event = { id: player.id, name: player.name, text };
    this.#record("chat", event);
    this.emit("chat", event);
    return true;
  }

  summary() {
    return { id: this.id, name: this.name, players: this.players.size, capacity: this.maximum, replayId: this.replayId, arena: {} };
  }

  close() {
    if (!this.#log.destroyed && !this.#log.writableEnded) this.#log.end();
    return this.logDone;
  }
}

export class RoomManager {
  #rooms = new Map<string, Room>();
  #closing = new Set<Promise<void>>();
  logDir: string;

  private readonly limit: number;
  private readonly players: number;

  constructor(logDir: string, limit = 16, players = 8) {
    this.logDir = logDir;
    this.limit = limit;
    this.players = players;
  }

  counts() {
    let players = 0;
    for (const room of this.#rooms.values()) players += room.players.size;
    return { rooms: this.#rooms.size, players };
  }

  create(name: string) {
    if (this.#rooms.size >= this.limit) return null;
    const room = new Room(name, this.logDir, this.players);
    const expire = setTimeout(() => this.#remove(room), 90_000).unref();
    room.once("join", () => clearTimeout(expire));
    room.once("empty", () => this.#remove(room));
    room.once("close", () => clearTimeout(expire));
    this.#rooms.set(room.id, room);
    return room;
  }

  #remove(room: Room) {
    if (!this.#rooms.delete(room.id)) return;
    room.emit("close");
    const closed = room.close();
    this.#closing.add(closed);
    void closed.finally(() => this.#closing.delete(closed));
  }

  get(id: string) { return this.#rooms.get(id); }

  list() {
    if (!this.#rooms.size) this.create("Орбітальна арена");
    return [...this.#rooms.values()].map(room => room.summary());
  }

  async close() {
    for (const room of this.#rooms.values()) this.#remove(room);
    await Promise.all(this.#closing);
  }
}
