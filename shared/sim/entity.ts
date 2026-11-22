import { ARENA, wrap } from "./arena.ts";
import { integrate, shotFrom } from "./ship.ts";
import { Vector2 } from "./vector.ts";

import { entityId, IDLE, ZERO_SEQ, type Controls, type EntityId, type Kind } from "../protocol.ts";
import type { World } from "./world.ts";

export type SimEntity = Ship | Bullet | Asteroid | Explosion | Pickup;
type Point = { x: number; y: number };
type Behavior = (entity: SimEntity, world: World, dt: number) => void;

export class Entity<K extends Kind> {
  id: EntityId;
  readonly kind: K;
  readonly pos: Point;
  readonly vel: Point;
  angle: number;
  radius: number;
  alive: boolean;
  owner?: string;
  behavior: Behavior | null;
  static #id = 0;
  constructor(kind: K, pos: Vector2, vel = new Vector2(), radius = 0) {
    this.id = entityId.parse(++Entity.#id);
    this.kind = kind;
    this.pos = { x: pos.x, y: pos.y };
    this.vel = { x: vel.x, y: vel.y };
    this.angle = 0;
    this.radius = radius;
    this.alive = true;
    this.behavior = null;
  }

  update(dt: number) {
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
  }
}

export class Ship extends Entity<"ship"> {
  declare owner: string;
  thrust = false;
  cooldown = 0;
  score = 0;
  #hp = 3;
  #shield = false;

  constructor(pos: Vector2, owner = "player") {
    super("ship", pos, new Vector2(), 15);
    this.owner = owner;
  }

  get hp() { return this.#hp; }
  get shield() { return this.#shield; }

  protect() { this.#shield = true; }

  damage() {
    if (this.#shield) { this.#shield = false; return; }
    this.#hp--;
    if (this.hp <= 0) this.alive = false;
  }

  update(dt: number, input: Controls = IDLE) {
    const ship = integrate(
      { x: this.pos.x, y: this.pos.y, vx: this.vel.x, vy: this.vel.y, angle: this.angle },
      input, dt,
    );
    this.pos.x = ship.x;
    this.pos.y = ship.y;
    this.vel.x = ship.vx;
    this.vel.y = ship.vy;
    this.angle = ship.angle;
    this.thrust = ship.thrust;
    this.cooldown = Math.max(0, this.cooldown - dt);
  }

  fire(acquire: () => Bullet = () => new Bullet(new Vector2(), new Vector2(), this.owner)) {
    if (this.cooldown > 0) return null;
    this.cooldown = 0.22;
    const shot = shotFrom({ x: this.pos.x, y: this.pos.y, vx: this.vel.x, vy: this.vel.y, angle: this.angle });
    const bullet = acquire();
    bullet.reset(shot, this.owner, this.angle);
    return bullet;
  }
}

export class Bullet extends Entity<"bullet"> {
  declare owner: string;
  ttl = 0.85;
  shotSeq = ZERO_SEQ;

  constructor(pos: Vector2, vel: Vector2, owner: string) {
    super("bullet", pos, vel, 4);
    this.owner = owner;
  }

  reset(shot: Point & { vx: number; vy: number }, owner: string, angle: number) {
    this.pos.x = shot.x;
    this.pos.y = shot.y;
    this.vel.x = shot.vx;
    this.vel.y = shot.vy;
    this.owner = owner;
    this.angle = angle;
    this.ttl = 0.85;
    this.shotSeq = ZERO_SEQ;
    this.behavior = null;
    this.alive = true;
  }

  update(dt: number) {
    super.update(dt);
    this.ttl -= dt;
    if (this.ttl <= 0) this.alive = false;
  }
}

export class Asteroid extends Entity<"asteroid"> {
  hp = 2;

  constructor(pos: Vector2, vel: Vector2, radius = 25) {
    super("asteroid", pos, vel, radius);
  }

  update(dt: number) {
    super.update(dt);
    const { x, y } = this.pos;
    const limitX = ARENA.width - this.radius;
    const limitY = ARENA.height - this.radius;
    const hitX = x < this.radius || x > limitX;
    const hitY = y < this.radius || y > limitY;
    this.pos.x = Math.min(limitX, Math.max(this.radius, x));
    this.pos.y = Math.min(limitY, Math.max(this.radius, y));
    if (hitX) this.vel.x = -this.vel.x;
    if (hitY) this.vel.y = -this.vel.y;
    this.angle = wrap(this.angle + dt, Math.PI * 2);
  }
}

export class Explosion extends Entity<"explosion"> {
  ttl = 0.45;
  readonly particles = Array.from({ length: 12 }, () => ({
    pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 },
  }));

  constructor() { super("explosion", new Vector2()); }

  reset(pos: Point, random: () => number) {
    this.pos.x = pos.x;
    this.pos.y = pos.y;
    this.ttl = 0.45;
    this.alive = true;
    for (const particle of this.particles) {
      const angle = random() * Math.PI * 2;
      const speed = 30 + 150 * random();
      particle.pos.x = pos.x;
      particle.pos.y = pos.y;
      particle.vel.x = Math.cos(angle) * speed;
      particle.vel.y = Math.sin(angle) * speed;
    }
  }

  update(dt: number) {
    this.ttl -= dt;
    this.alive = this.ttl > 0;
    for (const particle of this.particles) {
      particle.pos.x += particle.vel.x * dt;
      particle.pos.y += particle.vel.y * dt;
    }
  }
}

export class Pickup extends Entity<"pickup"> {
  apply: (ship: Ship) => void;

  constructor(pos: Vector2, apply: (ship: Ship) => void) {
    super("pickup", pos, new Vector2(), 11);
    this.apply = apply;
  }
}

export function homing(targetKind: Kind, acceleration = 30): Behavior {
  return (entity, world, dt) => {
    let dx = 0, dy = 0;
    let minDistance = Infinity;
    for (const target of world.ofKind(targetKind)) {
      if (!target.alive || target === entity || (entity.owner && target.owner === entity.owner)) continue;
      const x = target.pos.x - entity.pos.x, y = target.pos.y - entity.pos.y;
      const distance = x * x + y * y;
      if (distance < minDistance) { minDistance = distance; dx = x; dy = y; }
    }
    const length = Math.hypot(dx, dy);
    if (length) {
      const inverse = 1 / length;
      entity.vel.x += dx * inverse * (acceleration * dt);
      entity.vel.y += dy * inverse * (acceleration * dt);
    }
  };
}
