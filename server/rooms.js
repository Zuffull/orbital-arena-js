import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export class Room extends EventEmitter {
  id = randomUUID();
  players = new Map();
  #log;

  constructor(name, logDir) {
    super();
    this.name = name;
    this.replayId = this.id + "-" + Date.now();
    this.#log = new Transform({
      writableObjectMode: true,
      transform(record, _encoding, next) {
        next(null, JSON.stringify(record) + "\n");
      },
    });
    this.on("error", error => console.error("Room log:", this.id, error.message));
    this.logDone = pipeline(this.#log, createWriteStream(join(logDir, this.replayId + ".ndjson")))
      .catch(error => this.emit("error", error));
  }

  #record(type, data) {
    if (!this.#log.destroyed) this.#log.write({ t: Date.now(), type, ...data });
    this.emit(type, data);
  }

  join(player) {
    if (this.players.size >= 8 || this.#log.writableLength >= 224) return false;
    this.players.set(player.id, player);
    this.#record("join", { id: player.id, name: player.name });
    return true;
  }

  leave(id) {
    if (!this.players.delete(id)) return;
    this.#record("leave", { id });
    if (!this.players.size) this.emit("empty");
  }

  chat(player, text) {
    if (this.#log.destroyed || this.#log.writableLength >= 224) return false;
    this.#record("chat", { id: player.id, name: player.name, text });
    return true;
  }

  summary() {
    return { id: this.id, name: this.name, players: this.players.size, replayId: this.replayId, arena: {} };
  }

  close() {
    if (!this.#log.destroyed && !this.#log.writableEnded) this.#log.end();
    return this.logDone;
  }
}

export class RoomManager {
  #rooms = new Map();
  #closing = new Set();

  constructor(logDir) { this.logDir = logDir; }

  create(name) {
    if (this.#rooms.size >= 16) return null;
    const room = new Room(name, this.logDir);
    const expire = setTimeout(() => this.#remove(room), 90_000).unref();
    room.once("join", () => clearTimeout(expire));
    room.once("empty", () => this.#remove(room));
    room.once("close", () => clearTimeout(expire));
    this.#rooms.set(room.id, room);
    return room;
  }

  #remove(room) {
    if (!this.#rooms.delete(room.id)) return;
    room.emit("close");
    const closed = room.close();
    this.#closing.add(closed);
    void closed.finally(() => this.#closing.delete(closed));
  }

  get(id) { return this.#rooms.get(id); }

  list() {
    if (!this.#rooms.size) this.create("Орбітальна арена");
    return [...this.#rooms.values()].map(room => room.summary());
  }

  async close() {
    for (const room of this.#rooms.values()) this.#remove(room);
    await Promise.all(this.#closing);
  }
}
