import { expect, test } from "vitest";
import { DT } from "./protocol.ts";
import { seededRandom } from "./random.ts";
import { entityState } from "./state.ts";
import { ARENA, interpolateShip, wrap, wrapShip } from "./sim/arena.ts";
import { circlesOverlap, collisionPairs } from "./sim/collision.ts";
import { Asteroid, Bullet, Explosion, Pickup, Ship, homing } from "./sim/entity.ts";
import { createShip, integrate, shotFrom } from "./sim/ship.ts";
import { Vector2 } from "./sim/vector.ts";
import { World } from "./sim/world.ts";

const idle = { turn: 0, thrust: false, fire: false };
const point = (x, y) => new Vector2(x, y);
const circle = (x, y, radius = 8, alive = true) => ({ pos: point(x, y), radius, alive });
test.each([
  ["zero", () => point().length(), 0],
  ["length", () => point(3, 4).length(), 5],
  ["add", () => point(2, 3).add(point(5, 2)), point(7, 5)],
  ["subtract", () => point(5, 2).sub(point(2, 3)), point(3, -1)],
  ["scale", () => point(2, 3).scale(3), point(6, 9)],
  ["dot", () => point(2, 3).dot(point(2, -3)), -5],
  ["normalize", () => point(4, 0).normalize(), point(1, 0)],
  ["normalize zero", () => point().normalize(), point()],
  ["rotate", () => point(1, 0).rotate(Math.PI / 2).y, 1],
  ["angle", () => Vector2.fromAngle(0), point(1, 0)],
])("vector %s", (_, fn, value) => expect(fn()).toEqual(value));

test.each([[-1, 999], [0, 0], [1000, 0], [1001, 1], [2400, 400]])("wraps %i into %i", (x, expected) => {
  expect(wrap(x, ARENA.width)).toBe(expected);
  expect(wrapShip({ x, y: 600 }).x).toBe(expected);
});
test("interpolates through the short side of the seam", () => {
  expect(interpolateShip({ x: 999, y: 598, angle: 0 }, { x: 1, y: 2, angle: 0 }, .5)).toEqual({ x: 0, y: 0, angle: 0 });
});
test.each([0, 1, -1])("integrates turn %s deterministically", turn => {
  const ship = createShip();
  const command = { ...idle, turn, thrust: true };
  const next = integrate(ship, command, DT);
  expect(integrate(ship, command, DT)).toEqual(next);
  expect(next.thrust).toBe(true);
  expect(ship.vx).toBe(0);
});
test("limits speed and applies drag", () => {
  const fast = integrate({ ...createShip(), vx: 900 }, idle, DT);
  expect(Math.hypot(fast.vx, fast.vy)).toBeCloseTo(430);
  expect(integrate({ ...createShip(), vx: 100 }, idle, DT).vx).toBeLessThan(100);
});
test("shot starts ahead of the hull", () => expect(shotFrom(createShip())).toEqual({ x: 520, y: 300, vx: 560, vy: 0 }));
test.each([[12, true], [16, true], [17, false], [999, true], [500, false]])("circle distance %i", (x, hit) => {
  expect(circlesOverlap(circle(0, 5), circle(x, 5))).toBe(hit);
});
test("collision pairs exclude dead and zero-radius entities", () => {
  const a = circle(0, 0), b = circle(4, 0);
  expect([...collisionPairs([a, b, circle(1, 1, 9, false), circle(1, 1, 0)])]).toEqual([[a, b]]);
});
test.each([1, 2, 42, 4201])("worlds using seed %i match on every step", seed => {
  const worlds = [new World(seededRandom(seed)), new World(seededRandom(seed))];
  for (const world of worlds) { world.populate(); world.addPlayer("p"); }
  for (let step = 0; step < 45; step++) {
    for (const world of worlds) world.step(DT, new Map([["p", { turn: step % 3 - 1, thrust: true, fire: step % 5 === 0, homing: true }]]));
    const [a, b] = worlds.map(world => [...world].map(e => entityState(e, "p")));
    expect(a).toEqual(b);
  }
});
test("different seeds place players in different positions", () => {
  expect(new World(seededRandom(1)).safeSpot()).not.toEqual(new World(seededRandom(2)).safeSpot());
});
test("bullet pool resets TTL, ownership, input sequence, and behavior", () => {
  const world = new World();
  const pilot = world.addPlayer("p", 0, point(500, 300));
  world.step(DT, new Map([["p", { ...idle, fire: true, seq: 20, homing: true }]]));
  const [original] = world.ofKind("bullet");
  const id = original.id;
  world.despawn(id);
  world.step(DT);
  pilot.cooldown = 0;
  world.removePlayer("p");
  world.addPlayer("other", 0, point(80, 80));
  world.step(DT, new Map([["other", { ...idle, fire: true }]]));
  const [reused] = world.ofKind("bullet");
  expect(reused).toBe(original);
  expect(reused).toMatchObject({ owner: "other", shotSeq: 0, ttl: .85, behavior: null, alive: true });
  expect(reused.id).not.toBe(id);
  expect(world.get(id)).toBeUndefined();
});
test("ship shields absorb one hit and damage stops the ship", () => {
  const ship = new Ship(point(1, 1));
  ship.protect();
  ship.damage();
  expect(ship.hp).toBe(3);
  for (let i = 0; i < 3; i++) ship.damage();
  expect(ship.alive).toBe(false);
});
test("firing during the cooldown is rejected", () => {
  const ship = new Ship(point(50, 50));
  expect(ship.fire()).toBeInstanceOf(Bullet);
  expect(ship.fire()).toBeNull();
});
test("expired bullet is removed", () => {
  const world = new World(), bullet = world.spawn(new Bullet(point(1, 1), point(0, 0), "a"));
  world.step(.9);
  expect(world.get(bullet.id)).toBeUndefined();
});
test("asteroid reflects off both boundaries", () => {
  const rock = new Asteroid(point(25, 25), point(-2, -4));
  rock.update(1);
  expect(rock.pos).toEqual({ x: 25, y: 25 });
  expect(rock.vel).toEqual({ x: 2, y: 4 });
});
test("pickup is consumed and grants protection", () => {
  const world = new World(), ship = world.addPlayer("p", 0, point(50, 50));
  const pickup = world.spawn(new Pickup(point(50, 50), vessel => vessel.protect()));
  world.step(DT);
  expect(ship.shield).toBe(true);
  expect(world.get(pickup.id)).toBeUndefined();
});
test("an explosion advances and resets pooled particle positions", () => {
  const e = new Explosion();
  const first = e.particles[0];
  e.reset(point(8, 9), () => 0);
  e.update(.1);
  expect(first.pos).toEqual({ x: 11, y: 9 });
  e.update(.4);
  expect(e.alive).toBe(false);
  e.reset(point(30, 50), () => 0);
  expect(e.particles[0]).toBe(first);
  expect(first.pos).toEqual({ x: 30, y: 50 });
});
test("homing accelerates toward the nearest enemy", () => {
  const world = new World();
  world.addPlayer("same", 0, point(30, 20));
  world.addPlayer("other", 0, point(10, 80));
  const bullet = new Bullet(point(10, 20), point(0, 0), "same");
  homing("ship", 60)(bullet, world, .1);
  expect(bullet.vel).toEqual({ x: 0, y: 6 });
});
test("asteroid hits can destroy a ship and it respawns with its score", () => {
  const world = new World(), ship = world.addPlayer("p", 12, point(250, 250));
  world.spawn(new Asteroid(point(250, 250), point(0, 0)));
  world.step(.5); world.step(.5); world.step(.5);
  expect(world.drainEvents().map(event => event.type)).toEqual(["hit", "hit", "hit", "exploded"]);
  expect(world.scoreOf("p")).toBe(12);
  world.step(2);
  expect([...world.ofKind("ship")]).toHaveLength(1);
  expect(world.scoreOf("p")).toBe(12);
});
