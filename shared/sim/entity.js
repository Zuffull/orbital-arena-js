import { ARENA, wrap } from "./arena.js";
import { integrate, shotFrom } from "./ship.js";
import { Vector2 } from "./vector.js";

export class Entity {
  static #id = 0;
  constructor(kind, pos, vel = new Vector2(), radius = 0) {
    this.id = ++Entity.#id;
    this.kind = kind;
    this.pos = pos;
    this.vel = vel;
    this.angle = 0;
    this.radius = radius;
    this.alive = true;
    this.behavior = null;
  }

  update(dt) { this.pos = this.pos.add(this.vel.scale(dt)); }
}

export class Ship extends Entity {
  #hp = 3;
  #shield = false;

  constructor(pos, owner = "player") {
    super("ship", pos, new Vector2(), 15);
    this.owner = owner;
    this.thrust = false;
    this.cooldown = 0;
    this.score = 0;
  }

  get hp() { return this.#hp; }
  get shield() { return this.#shield; }

  protect() { this.#shield = true; }

  damage() {
    if (this.#shield) { this.#shield = false; return; }
    this.#hp--;
    if (this.hp <= 0) this.alive = false;
  }

  update(dt, input) {
    const ship = integrate(
      { x: this.pos.x, y: this.pos.y, vx: this.vel.x, vy: this.vel.y, angle: this.angle },
      input, dt,
    );
    this.pos = new Vector2(ship.x, ship.y);
    this.vel = new Vector2(ship.vx, ship.vy);
    this.angle = ship.angle;
    this.thrust = ship.thrust;
    this.cooldown = Math.max(0, this.cooldown - dt);
  }

  fire() {
    if (this.cooldown > 0) return null;
    this.cooldown = 0.22;
    const shot = shotFrom({ x: this.pos.x, y: this.pos.y, vx: this.vel.x, vy: this.vel.y, angle: this.angle });
    const bullet = new Bullet(new Vector2(shot.x, shot.y), new Vector2(shot.vx, shot.vy), this.owner);
    bullet.angle = this.angle;
    return bullet;
  }
}

export class Bullet extends Entity {
  constructor(pos, vel, owner) {
    super("bullet", pos, vel, 4);
    this.owner = owner;
    this.ttl = 0.85;
  }

  update(dt) {
    super.update(dt);
    this.ttl -= dt;
    if (this.ttl <= 0) this.alive = false;
  }
}

export class Asteroid extends Entity {
  constructor(pos, vel, radius = 25) {
    super("asteroid", pos, vel, radius);
    this.hp = 2;
  }

  update(dt) {
    super.update(dt);
    const { x, y } = this.pos;
    const limitX = ARENA.width - this.radius;
    const limitY = ARENA.height - this.radius;
    const hitX = x < this.radius || x > limitX;
    const hitY = y < this.radius || y > limitY;
    this.pos = new Vector2(Math.min(limitX, Math.max(this.radius, x)), Math.min(limitY, Math.max(this.radius, y)));
    this.vel = new Vector2(hitX ? -this.vel.x : this.vel.x, hitY ? -this.vel.y : this.vel.y);
    this.angle = wrap(this.angle + dt, Math.PI * 2);
  }
}

export class Explosion extends Entity {
  constructor(pos, random) {
    super("explosion", pos);
    this.ttl = 0.45;
    this.particles = Array.from({ length: 12 }, () => ({
      pos,
      vel: Vector2.fromAngle(random() * Math.PI * 2).scale(30 + 150 * random()),
    }));
  }

  update(dt) {
    this.ttl -= dt;
    this.alive = this.ttl > 0;
    for (const particle of this.particles) particle.pos = particle.pos.add(particle.vel.scale(dt));
  }
}

export class Pickup extends Entity {
  constructor(pos, apply) {
    super("pickup", pos, new Vector2(), 11);
    this.apply = apply;
  }
}

export function homing(targetKind, acceleration = 30) {
  return (entity, world, dt) => {
    let nearest;
    let minDistance = Infinity;
    for (const target of world.ofKind(targetKind)) {
      if (!target.alive || target === entity || (entity.owner && target.owner === entity.owner)) continue;
      const delta = target.pos.sub(entity.pos);
      const distance = delta.dot(delta);
      if (distance < minDistance) { minDistance = distance; nearest = delta; }
    }
    if (nearest) entity.vel = entity.vel.add(nearest.normalize().scale(acceleration * dt));
  };
}
