import { ARENA, wrap } from "./arena.js";
import { circlesOverlap, collisionPairs } from "./collision.js";
import { Asteroid, Explosion, homing, Pickup, Ship } from "./entity.js";
import { seededRandom } from "../random.js";
import { Vector2 } from "./vector.js";

const idle = { turn: 0, thrust: false, fire: false };

export class World {
  #entities = new Map();
  #nextId = 0;
  #respawns = new Map();
  #events = [];
  #invulnerable = new Map();

  constructor(random = seededRandom(1)) { this.random = random; }
  spawn(entity) { entity.id = ++this.#nextId; this.#entities.set(entity.id, entity); return entity; }
  despawn(id) { const target = this.get(id); if (target) target.alive = false; }
  get(id) { return this.#entities.get(id); }
  [Symbol.iterator]() { return this.#entities.values(); }
  *ofKind(kind) { for (const entity of this) if (entity.kind === kind) yield entity; }
  drainEvents() { return this.#events.splice(0); }

  addPlayer(owner, score = 0, position = this.safeSpot()) {
    const ship = new Ship(position, owner);
    ship.score = score;
    return this.spawn(ship);
  }

  removePlayer(owner) {
    this.#respawns.delete(owner);
    this.#invulnerable.delete(owner);
    for (const entity of this) if (entity.owner === owner) this.#entities.delete(entity.id);
  }

  scoreOf(owner) {
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
    for (const [x, y, vx, vy] of [[220,160,44,28], [740,190,-30,40], [650,430,25,-36], [290,450,-40,-25]].slice(0, asteroids)) {
      this.spawn(new Asteroid(new Vector2(x, y), new Vector2(vx, vy)));
    }
    const seeker = this.spawn(new Asteroid(new Vector2(500, 80), new Vector2(-20, 32), 19));
    seeker.behavior = homing("ship", 9);
    this.spawn(new Pickup(new Vector2(680, 300), ship => ship.protect()));
  }

  step(dt, inputs = new Map()) {
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
    for (const entity of [...this]) {
      if (!entity.alive) continue;
      entity.behavior?.(entity, this, dt);
      const input = inputs.get(entity.owner) || idle;
      entity.update(dt, input);
      if (entity.kind === "ship" || entity.kind === "bullet") {
        entity.pos = new Vector2(wrap(entity.pos.x, ARENA.width), wrap(entity.pos.y, ARENA.height));
      }
      if (entity.kind === "ship" && input.fire) {
        const bullet = entity.fire();
        if (bullet) {
          bullet.shotSeq = input.seq ?? 0;
          if (input.homing) bullet.behavior = homing("ship", 720);
          this.spawn(bullet);
          this.#events.push({ type: "fired", owner: entity.owner, id: bullet.id });
        }
      }
    }
    for (const [a, b] of collisionPairs(this)) if (a.alive && b.alive) {
      this.#resolve(a, b);
      this.#resolve(b, a);
    }
    for (const entity of this) if (!entity.alive) this.#entities.delete(entity.id);
  }

  #resolve(a, b) {
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

  #damage(target, attacker) {
    this.#events.push({ type: "hit", target: target.id });
    if (target.kind === "ship") {
      target.damage();
      this.#invulnerable.set(target.owner, 0.45);
    } else if (--target.hp <= 0) this.despawn(target.id);
    if (target.alive) return;
    this.#events.push({ type: "exploded", target: target.id });
    this.spawn(new Explosion(target.pos, this.random));
    for (const ship of this.ofKind("ship")) if (ship.owner === attacker) ship.score++;
    if (target.kind === "ship") this.#respawns.set(target.owner, { remaining: 2, score: target.score });
  }
}
