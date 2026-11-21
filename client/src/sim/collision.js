import { ARENA } from "./arena.js";

export function circlesOverlap(a, b) {
  const dx = Math.abs(a.pos.x - b.pos.x);
  const dy = Math.abs(a.pos.y - b.pos.y);
  const x = Math.min(dx, Math.abs(ARENA.width - dx));
  const y = Math.min(dy, Math.abs(ARENA.height - dy));
  return x * x + y * y <= (a.radius + b.radius) ** 2;
}

export function* collisionPairs(world) {
  const all = [...world].filter(entity => entity.alive && entity.radius > 0);
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (circlesOverlap(all[i], all[j])) yield [all[i], all[j]];
    }
  }
}
