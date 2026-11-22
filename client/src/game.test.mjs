import { afterEach, expect, test, vi } from "vitest";
import { createLoop } from "./loop.ts";
import { advance, delta, snapshots } from "./prediction.ts";
import { World } from "../../shared/sim/world.ts";
import { Vector2 } from "../../shared/sim/vector.ts";
import { entityState } from "../../shared/state.ts";
import { DT } from "../../shared/protocol.ts";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function clock() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("requestAnimationFrame", cb => setTimeout(() => cb(performance.now()), 17));
  vi.stubGlobal("cancelAnimationFrame", id => clearTimeout(id));
}

test("fixed loop performs 60 steps per simulated second, independently of frames", () => {
  clock();
  const simulate = vi.fn(), render = vi.fn();
  const loop = createLoop({ simulate, render });
  loop.start();
  vi.advanceTimersByTime(1020);
  expect(simulate.mock.calls.length).toBeGreaterThanOrEqual(59);
  expect(simulate.mock.calls.length).toBeLessThanOrEqual(61);
  expect(render.mock.calls.length).toBe(60);
  expect(simulate).toHaveBeenCalledWith(1 / 60);
  loop.stop();
});
test("stop cancels queued frames and start is idempotent", () => {
  clock();
  const render = vi.fn();
  const loop = createLoop({ simulate: vi.fn(), render });
  loop.start(); loop.start();
  vi.advanceTimersByTime(34);
  expect(render).toHaveBeenCalledTimes(2);
  loop.stop();
  vi.advanceTimersByTime(100);
  expect(render).toHaveBeenCalledTimes(2);
});
test.each(["variable", "interval"])("experiment mode %s produces the expected timing", mode => {
  clock();
  const simulate = vi.fn(), onFrame = vi.fn();
  const loop = createLoop({ mode, simulate, render: vi.fn(), onFrame });
  loop.start(); vi.advanceTimersByTime(60);
  expect(simulate).toHaveBeenCalledWith(mode === "interval" ? 1 / 60 : .017);
  expect(onFrame).toHaveBeenCalledWith(mode === "interval" ? 16 : 17);
  loop.stop();
});
const cmd = seq => ({ type: "input", seq, thrust: true, turn: seq % 3 - 1, fire: false, homing: false });
test.each([1, 4, 12])("client replay of %i unacknowledged commands matches the authoritative world", count => {
  const world = new World();
  const ship = world.addPlayer("player", 0, new Vector2(995, 590));
  world.step(DT, new Map([["player", cmd(1)]]));
  let local = entityState(ship, "player");
  for (let seq = 2; seq <= count + 1; seq++) {
    world.step(DT, new Map([["player", cmd(seq)]]));
    local = advance(local, cmd(seq)).ship;
  }
  expect(local).toEqual(entityState(ship, "player"));
});
test("reconciliation uses the smallest wrapped displacement", () => {
  expect(delta({ x: 1, y: 599 }, { x: 999, y: 1 })).toEqual({ x: 2, y: -2 });
});
test("snapshot buffer discards duplicates and interpolates positions", () => {
  const frames = snapshots();
  const world = new World();
  const ship = world.addPlayer("player", 0, new Vector2(990, 50));
  const entity = entityState(ship, "player");
  frames.push({ tick: 2, entities: [entity] }, 10);
  frames.push({ tick: 2, entities: [] }, 11);
  frames.push({ tick: 3, entities: [{ ...entity, x: 10 }] }, 45);
  expect(frames.at(10 + 1000 * DT / 2)[0].x).toBeCloseTo(0);
  frames.clear();
  expect(frames.at(50)).toEqual([]);
});
