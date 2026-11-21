import { ARENA, wrap } from "./arena.ts";

import type { Controls } from "../protocol.ts";

export type Kinematics = Readonly<{ x: number; y: number; vx: number; vy: number; angle: number }>;

export function createShip() {
  return { x: ARENA.width / 2, y: ARENA.height / 2, vx: 0, vy: 0, angle: 0, thrust: false };
}

export function shotFrom(ship: Kinematics) {
  const x = Math.cos(ship.angle), y = Math.sin(ship.angle);
  return { x: ship.x + x * 20, y: ship.y + y * 20, vx: ship.vx + x * 560, vy: ship.vy + y * 560 };
}

export function integrate(ship: Kinematics, input: { turn: number; thrust: Controls["thrust"] }, dt: number) {
  const angle = wrap(ship.angle + input.turn * 3.8 * dt, 2 * Math.PI);
  const acceleration = input.thrust ? 360 : 0;
  const drag = Math.exp(-0.65 * dt);
  let vx = (ship.vx + Math.cos(angle) * acceleration * dt) * drag;
  let vy = (ship.vy + Math.sin(angle) * acceleration * dt) * drag;
  const speed = Math.hypot(vx, vy);
  if (speed > 430) {
    vx *= 430 / speed;
    vy *= 430 / speed;
  }
  return { x: ship.x + vx * dt, y: ship.y + vy * dt, vx, vy, angle, thrust: input.thrust };
}
