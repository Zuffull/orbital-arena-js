import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { decodeInput, decodeSnapshot, encodeInput, encodeSnapshot } from "../shared/codec.ts";
import { DT, parseClientMessage } from "../shared/protocol.ts";
import { seededRandom } from "../shared/random.ts";
import { World } from "../shared/sim/world.ts";
import { entityState } from "../shared/state.ts";

const command = seq => ({ type: "input", seq, turn: seq % 3 - 1, thrust: seq % 4 !== 0,
  fire: seq % 6 === 0, homing: seq % 17 === 0 });

test("seed 4201 still matches the Lab 05 simulation after 300 ticks", () => {
  const world = new World(seededRandom(4201));
  world.populate();
  world.addPlayer("player");
  world.addPlayer("opponent");
  for (let seq = 1; seq <= 300; seq++) {
    world.step(DT, new Map([["player", command(seq)]]));
    world.drainEvents();
  }
  const data = [...world].map(entity => entityState(entity, "player")).map(e =>
    [e.id, e.kind, e.x, e.y, e.vx, e.vy, e.angle, e.hp].map(v => typeof v === "number" ? Math.fround(v) : v));
  const hash = createHash("sha256").update(JSON.stringify(data)).digest("hex");
  assert.equal(hash, "3a3a4a0196ec6bca0b05baab5a764208521693994fb6d0d5f5885b5c97f34b7e");
});

test("v1 inputs and snapshots retain the binary format", () => {
  const input = command(257);
  assert.equal(encodeInput(input).byteLength, 8);
  assert.deepEqual(decodeInput(encodeInput(input)), input);
  assert.deepEqual(parseClientMessage({ v: 1, ...input }), { v: 1, ...input });
  assert.equal(parseClientMessage({ v: 1, ...input, turn: 3 }), null);
  const world = new World();
  const entity = entityState(world.addPlayer("player"), "player");
  const packet = { tick: 1, ack: 257, score: 0, entities: [{ ...entity, x: Math.fround(entity.x), y: Math.fround(entity.y) }] };
  const buffer = encodeSnapshot(packet);
  assert.equal(buffer.byteLength, 48);
  assert.deepEqual(decodeSnapshot(buffer), { v: 1, type: "snapshot", ...packet });
  assert.throws(() => decodeSnapshot(buffer.slice(0, -1)), RangeError);
  const wrongVersion = buffer.slice(0);
  new DataView(wrongVersion).setUint8(0, 255);
  assert.throws(() => decodeSnapshot(wrongVersion), RangeError);
  const wrongKind = buffer.slice(0);
  new DataView(wrongKind).setUint8(20, 255);
  assert.throws(() => decodeSnapshot(wrongKind), RangeError);
  const wrongPosition = buffer.slice(0);
  new DataView(wrongPosition).setFloat32(22, Infinity, true);
  assert.throws(() => decodeSnapshot(wrongPosition), RangeError);
});
