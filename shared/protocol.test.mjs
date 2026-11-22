import { expect, test } from "vitest";
import fc from "fast-check";
import { decodeInput, decodeSnapshot, encodeInput, encodeSnapshot } from "./codec.ts";
import { parseClientMessage, readInput, serverMessage, unreachable } from "./protocol.ts";
import { ARENA, wrapShip } from "./sim/arena.ts";
import { createShip, integrate } from "./sim/ship.ts";

const cases = { numRuns: 120, seed: 4201 };
const uint = fc.integer({ min: 0, max: 0xffffffff });
const finite = fc.float({ min: -1200, max: 1200, noNaN: true, noDefaultInfinity: true });
const controls = fc.record(controlsArbs());
const input = fc.record({ type: fc.constant("input"), seq: fc.integer({ min: 1, max: 0xffffffff }), ...controlsArbs() });
function controlsArbs() {
  return { turn: fc.constantFrom(-1, 0, 1), thrust: fc.boolean(), fire: fc.boolean(), homing: fc.boolean() };
}
const entity = fc.record({
  id: fc.integer({ min: 1, max: 0xffffffff }),
  kind: fc.constantFrom("ship", "bullet", "asteroid", "pickup", "explosion"),
  self: fc.boolean(), thrust: fc.boolean(), shield: fc.boolean(), homing: fc.boolean(),
  x: finite, y: finite, vx: finite, vy: finite,
  angle: fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
  radius: fc.integer({ min: 0, max: 255 }), hp: fc.integer({ min: 0, max: 255 }),
  cooldown: fc.integer({ min: 0, max: 65535 }).map(v => v / 1000), shotSeq: uint,
});
const packet = fc.record({ tick: uint, ack: uint, score: uint, entities: fc.array(entity, { maxLength: 24 }) });

test("input survives binary round trip", () => {
  fc.assert(fc.property(input, cmd => { expect(decodeInput(encodeInput(cmd))).toEqual({ ...cmd }); }), cases);
});

test("snapshot survives binary round trip with int16 angle quantization", () => {
  fc.assert(fc.property(packet, value => {
    const decoded = decodeSnapshot(encodeSnapshot(value));
    expect(decoded.tick).toBe(value.tick);
    expect(decoded.ack).toBe(value.ack);
    expect(decoded.score).toBe(value.score);
    expect(decoded.entities).toHaveLength(value.entities.length);
    for (const [i, e] of value.entities.entries()) {
      const d = decoded.entities[i];
      const difference = Math.atan2(Math.sin(d.angle - e.angle), Math.cos(d.angle - e.angle));
      expect(Math.abs(difference)).toBeLessThanOrEqual(Math.PI / 65536 + 1e-12);
      expect({ ...d, angle: e.angle }).toEqual(e);
    }
  }), cases);
});

test("frame length matches the documented wire layout", () => {
  fc.assert(fc.property(input, packet, (cmd, value) => {
    expect(encodeInput(cmd).byteLength).toBe(8);
    expect(encodeSnapshot(value).byteLength).toBe(16 + value.entities.length * 32);
  }), cases);
});

test("corrupt version and truncated frames produce controlled errors", () => {
  fc.assert(fc.property(input, packet, (cmd, value) => {
    const inWire = new Uint8Array(encodeInput(cmd));
    inWire[0] = 255;
    expect(() => decodeInput(inWire)).toThrow(RangeError);
    expect(() => decodeSnapshot(encodeSnapshot(value).slice(0, -1))).toThrow(RangeError);
  }), cases);
});

test("wrapped ships remain inside the arena through random commands", () => {
  fc.assert(fc.property(finite, finite, fc.array(controls, { minLength: 1, maxLength: 80 }), (x, y, commands) => {
    let ship = wrapShip({ ...createShip(), x, y });
    for (const cmd of commands) {
      ship = wrapShip(integrate(ship, cmd, 1 / 30));
      expect(ship.x).toBeGreaterThanOrEqual(0);
      expect(ship.x).toBeLessThan(ARENA.width);
      expect(ship.y).toBeGreaterThanOrEqual(0);
      expect(ship.y).toBeLessThan(ARENA.height);
    }
  }), cases);
});

test("Zod accepts legitimate inputs and rejects corrupted variants", () => {
  fc.assert(fc.property(input, cmd => {
    expect(parseClientMessage({ v: 1, ...cmd })).toEqual({ v: 1, ...cmd });
    expect(parseClientMessage({ v: 1, ...cmd, thrust: "yes" })).toBeNull();
    expect(parseClientMessage({ v: 2, ...cmd })).toBeNull();
  }), cases);
});

test.each([null, [], {}, 3, "input", { type: "input", seq: -1 }, { type: "probe", v: 1, nonce: -1 }])("rejects malformed input %j", value => {
  expect(readInput(value)).toBeNull();
  expect(parseClientMessage(value)).toBeNull();
});
test.each([
  { type: "joined", id: "A", replayId: "log", seed: 0 },
  { type: "probe", nonce: 10 },
  { type: "notice", text: "Info" },
  { type: "chat", id: "A", name: "Pilot", text: "Hi" },
  { type: "roster", players: [{ id: "A", name: "Pilot" }] },
  { type: "snapshot", tick: 2, ack: 0, score: 0, entities: [] },
])("parses server variant $type", value => expect(serverMessage.parse({ v: 1, ...value })).toEqual({ v: 1, ...value }));
test("rejects input flags outside 3 bits", () => {
  const wire = encodeInput({ type: "input", seq: 1, turn: 0, thrust: false, fire: false, homing: false });
  new DataView(wire).setUint8(7, 8);
  expect(() => decodeInput(wire)).toThrow(RangeError);
});
test("rejects invalid input passed to the encoder", () => expect(() => encodeInput({})).toThrow(RangeError));
test("rejects a snapshot count larger than 1024", () => expect(() => encodeSnapshot({ tick: 1, ack: 0, score: 0, entities: Array(1025) })).toThrow(RangeError));
test("rejects a malformed entity passed to the encoder", () => expect(() => encodeSnapshot({ tick: 1, ack: 0, score: 0, entities: [{ id: 0, kind: "asteroid" }] })).toThrow(RangeError));
test("throws for an unreachable variant at runtime", () => expect(() => unreachable("other")).toThrow("Unhandled"));
