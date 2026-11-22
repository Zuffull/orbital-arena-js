import { ARENA, wrap } from "./arena.ts";
import { circlesOverlap, collisionPairs } from "./collision.ts";
import { Asteroid, Bullet, Explosion, homing, Pickup, Ship, type SimEntity } from "./entity.ts";
import { seededRandom } from "../random.ts";
import { Vector2 } from "./vector.ts";

import { entityId, IDLE, ZERO_SEQ, type Controls, type EntityId, type Kind } from "../protocol.ts";

export type WorldEvent =
  | { type: "fired"; owner: string; id: EntityId }
  | { type: "hit" | "exploded"; target: EntityId };

const turnBullet = homing("ship", 720);
const emptyInputs: ReadonlyMap<string, Controls> = new Map();

export class World {
  #entities = new Map<EntityId, SimEntity>();
  #nextId = 0;
  #respawns = new Map<string, { remaining: number; score: number }>();
  #events: WorldEvent[] = [];
  #invulnerable = new Map<string, number>();
  #bullets: Bullet[] = [];
  #explosions: Explosion[] = [];
  #updateList: SimEntity[] = [];
  #takeBullet = () => this.#bullets.pop() ?? new Bullet(new Vector2(), new Vector2(), "");

  #release(entity: SimEntity) {
    this.#entities.delete(entity.id);
    if (entity.kind === "bullet" && this.#bullets.length < 256) this.#bullets.push(entity);
    if (entity.kind === "explosion" && this.#explosions.length < 32) this.#explosions.push(entity);
  }

  random: () => number;

  constructor(random = seededRandom(1)) { this.random = random; }
  spawn<T extends SimEntity>(entity: T): T { entity.id = entityId.parse(++this.#nextId); this.#entities.set(entity.id, entity); return entity; }
  despawn(id: EntityId) { const target = this.get(id); if (target) target.alive = false; }
  get(id: EntityId) { return this.#entities.get(id); }
  [Symbol.iterator]() { return this.#entities.values(); }
  *ofKind<K extends Kind>(kind: K): Generator<Extract<SimEntity, { kind: K }>> {
    const matches = (entity: SimEntity): entity is Extract<SimEntity, { kind: K }> => entity.kind === kind;
    for (const entity of this) if (matches(entity)) yield entity;
  }
  drainEvents() { return this.#events.splice(0); }

  addPlayer(owner: string, score = 0, position = this.safeSpot()) {
    const ship = new Ship(position, owner);
    ship.score = score;
    return this.spawn(ship);
  }

  removePlayer(owner: string) {
    this.#respawns.delete(owner);
    this.#invulnerable.delete(owner);
    for (const entity of this) if (entity.owner === owner) this.#release(entity);
  }

  scoreOf(owner: string) {
    for (const ship of this.ofKind("ship")) if (ship.owner === owner) return ship.score;
    return this.#respawns.get(owner)?.score ?? 0;
  }

  safeSpot() {
    const point = () => new Vector2(80 + this.random() * 840, 80 + this.random() * 440);
    let candidate = point();
    for (let i = 0; i < 24; i++) {
      if (![...this].some(entity => entity.alive && entity.radius && circlesOverlap({ pos: candidate, radius: 45 }, entity))) break;
      candidate = point();
    }
    return candidate;
  }

  populate({ asteroids = 4 } = {}) {
    const positions: [number, number, number, number][] = [[220,160,44,28], [740,190,-30,40], [650,430,25,-36], [290,450,-40,-25]];
    for (const [x, y, vx, vy] of positions.slice(0, asteroids)) {
      this.spawn(new Asteroid(new Vector2(x, y), new Vector2(vx, vy)));
    }
    const seeker = this.spawn(new Asteroid(new Vector2(500, 80), new Vector2(-20, 32), 19));
    seeker.behavior = homing("ship", 9);
    this.spawn(new Pickup(new Vector2(680, 300), ship => ship.protect()));
  }

  step(dt: number, inputs: ReadonlyMap<string, Controls> = emptyInputs) {
    for (const [owner, remaining] of this.#invulnerable) {
      if (remaining <= dt) this.#invulnerable.delete(owner);
      else this.#invulnerable.set(owner, remaining - dt);
    }
    for (const [owner, pending] of this.#respawns) {
      pending.remaining -= dt;
      if (pending.remaining <= 1e-9) {
        this.addPlayer(owner, pending.score);
        this.#respawns.delete(owner);
      }
    }
    for (const entity of this) this.#updateList.push(entity);
    for (const entity of this.#updateList) {
      if (!entity.alive) continue;
      entity.behavior?.(entity, this, dt);
      const input = (entity.owner === undefined ? undefined : inputs.get(entity.owner)) ?? IDLE;
      if (entity.kind === "ship") entity.update(dt, input);
      else entity.update(dt);
      if (entity.kind === "ship" || entity.kind === "bullet") {
        entity.pos.x = wrap(entity.pos.x, ARENA.width);
        entity.pos.y = wrap(entity.pos.y, ARENA.height);
      }
      if (entity.kind === "ship" && input.fire) {
        const bullet = entity.fire(this.#takeBullet);
        if (bullet) {
          bullet.shotSeq = input.seq ?? ZERO_SEQ;
          if (input.homing) bullet.behavior = turnBullet;
          this.spawn(bullet);
          this.#events.push({ type: "fired", owner: entity.owner, id: bullet.id });
        }
      }
    }
    this.#updateList.length = 0;
    for (const [a, b] of collisionPairs(this)) if (a.alive && b.alive) {
      this.#resolve(a, b);
      this.#resolve(b, a);
    }
    for (const entity of this) if (!entity.alive) this.#release(entity);
  }

  #resolve(a: SimEntity, b: SimEntity) {
    if (a.kind === "pickup" && b.kind === "ship") {
      a.apply(b);
      this.despawn(a.id);
    }
    if (a.kind === "asteroid" && b.kind === "ship" && !this.#invulnerable.has(b.owner)) this.#damage(b);
    if (a.kind === "bullet" && (b.kind === "asteroid" || (b.kind === "ship" && a.owner !== b.owner))) {
      this.despawn(a.id);
      this.#damage(b, a.owner);
    }
  }

  #damage(target: Ship | Asteroid, attacker?: string) {
    this.#events.push({ type: "hit", target: target.id });
    if (target.kind === "ship") {
      target.damage();
      this.#invulnerable.set(target.owner, 0.45);
    } else if (--target.hp <= 0) this.despawn(target.id);
    if (target.alive) return;
    this.#events.push({ type: "exploded", target: target.id });
    const explosion = this.#explosions.pop() ?? new Explosion();
    explosion.reset(target.pos, this.random);
    this.spawn(explosion);
    for (const ship of this.ofKind("ship")) if (ship.owner === attacker) ship.score++;
    if (target.kind === "ship") this.#respawns.set(target.owner, { remaining: 2, score: target.score });
  }
}
