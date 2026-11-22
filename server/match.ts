import { randomBytes } from "node:crypto";
import { encodeSnapshot } from "../shared/codec.ts";
import { DT, IDLE, tickNumber, VERSION, type Controls, type Input, type Snapshot } from "../shared/protocol.ts";
import { seededRandom } from "../shared/random.ts";
import { entityState } from "../shared/state.ts";
import { World } from "../shared/sim/world.ts";

import type { Player, Room } from "./rooms.ts";
import type { send } from "./ws.ts";

const period = DT * 1000;
export const matches = new Map<string, Match>();

export class Match {
  seed = randomBytes(4).readUInt32LE();
  world = new World(seededRandom(this.seed));
  tick = tickNumber.parse(0);
  room: Room;
  send: typeof send;
  #timings: { duration: number; physics: number; jitter: number }[] = [];
  #inputs = new Map<string, Controls>();
  #timer;
  #target = performance.now() + period;

  constructor(room: Room, sendPacket: typeof send) {
    this.room = room;
    this.send = sendPacket;
    this.world.populate();
    room.on("join", ({ id }) => this.world.addPlayer(id));
    room.on("leave", ({ id }) => this.world.removePlayer(id));
    room.once("close", () => {
      clearTimeout(this.#timer);
      matches.delete(room.id);
    });
    matches.set(room.id, this);
    this.#timer = setTimeout(() => this.step(), period).unref();
  }

  input(player: Player, input: Input) {
    if (input.seq > player.ack && input.seq <= player.ack + 128 && player.inputs.size < 64) {
      player.inputs.set(input.seq, input);
    }
  }

  step() {
    const start = performance.now();
    this.#inputs.clear();
    for (const player of this.room.players.values()) {
      let input: Input | undefined;
      for (const item of player.inputs.values()) if (!input || item.seq < input.seq) input = item;
      if (input) {
        player.inputs.delete(input.seq);
        player.ack = input.seq;
      }
      this.#inputs.set(player.id, input ?? IDLE);
    }
    const simulationStart = performance.now();
    this.world.step(DT, this.#inputs);
    const physics = performance.now() - simulationStart;
    this.world.drainEvents();
    this.tick = tickNumber.parse((this.tick + 1) >>> 0);
    for (const player of this.room.players.values()) {
      const packet: Snapshot = {
        v: VERSION, type: "snapshot", tick: this.tick, ack: player.ack,
        score: this.world.scoreOf(player.id),
        entities: [...this.world].map(entity => entityState(entity, player.id)),
      };
      const wire = player.binary ? encodeSnapshot(packet) : packet;
      player.link.schedule(() => this.send(player.socket, wire));
    }
    this.#timings.push({ duration: performance.now() - start, physics, jitter: Math.abs(start - this.#target) });
    if (this.#timings.length > 300) this.#timings.shift();
    this.#target += period;
    if (start - this.#target > period * 4) this.#target = start + period;
    this.#timer = setTimeout(() => this.step(), Math.max(0, this.#target - performance.now())).unref();
  }

  stats() {
    const samples = this.#timings;
    const mean = (key: "duration" | "jitter" | "physics") => samples.reduce((sum, value) => sum + value[key], 0) / Math.max(1, samples.length);
    const durations = samples.map(({ duration }) => duration).sort((a, b) => a - b);
    return {
      p99TickMs: durations[Math.ceil(durations.length * .99) - 1] ?? 0,
      maxTickMs: durations.at(-1) ?? 0,
      meanPhysicsMs: mean("physics"),
      room: this.room.id, tick: this.tick, samples: samples.length, intervalMs: period,
      meanTickMs: mean("duration"), meanJitterMs: mean("jitter"), maxJitterMs: Math.max(0, ...samples.map(item => item.jitter)),
    };
  }
}
