import { randomBytes } from "node:crypto";
import { encodeSnapshot } from "../shared/codec.js";
import { DT, IDLE, VERSION } from "../shared/protocol.js";
import { seededRandom } from "../shared/random.js";
import { entityState } from "../shared/state.js";
import { World } from "../shared/sim/world.js";

const period = DT * 1000;
export const matches = new Map();

export class Match {
  seed = randomBytes(4).readUInt32LE();
  world = new World(seededRandom(this.seed));
  tick = 0;
  #timings = [];
  #timer;
  #target = performance.now() + period;

  constructor(room, send) {
    this.room = room;
    this.send = send;
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

  input(player, input) {
    if (input.seq > player.ack && input.seq <= player.ack + 128 && player.inputs.size < 64) {
      player.inputs.set(input.seq, input);
    }
  }

  step() {
    const start = performance.now();
    const inputs = new Map();
    for (const player of this.room.players.values()) {
      const seq = Math.min(...player.inputs.keys());
      const input = player.inputs.get(seq);
      if (input) {
        player.inputs.delete(seq);
        player.ack = seq;
      }
      inputs.set(player.id, input ?? IDLE);
    }
    this.world.step(DT, inputs);
    this.world.drainEvents();
    this.tick++;
    for (const player of this.room.players.values()) {
      const packet = {
        v: VERSION, type: "snapshot", tick: this.tick, ack: player.ack,
        score: this.world.scoreOf(player.id),
        entities: [...this.world].map(entity => entityState(entity, player.id)),
      };
      const wire = player.binary ? encodeSnapshot(packet) : packet;
      player.link.schedule(() => this.send(player.socket, wire));
    }
    this.#timings.push({ duration: performance.now() - start, jitter: Math.abs(start - this.#target) });
    if (this.#timings.length > 300) this.#timings.shift();
    this.#target += period;
    if (start - this.#target > period * 4) this.#target = start + period;
    this.#timer = setTimeout(() => this.step(), Math.max(0, this.#target - performance.now())).unref();
  }

  stats() {
    const samples = this.#timings;
    const mean = key => samples.reduce((sum, value) => sum + value[key], 0) / Math.max(1, samples.length);
    return {
      room: this.room.id, tick: this.tick, samples: samples.length, intervalMs: period,
      meanTickMs: mean("duration"), meanJitterMs: mean("jitter"), maxJitterMs: Math.max(0, ...samples.map(item => item.jitter)),
    };
  }
}
