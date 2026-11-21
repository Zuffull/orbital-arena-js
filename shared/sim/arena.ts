type Pose = Readonly<{ x: number; y: number; angle: number }>;

export const ARENA = { width: 1000, height: 600 };

export function wrap(value: number, size: number) {
  return ((value % size) + size) % size;
}

export function wrapShip<T extends { x: number; y: number }>(ship: T): T {
  return { ...ship, x: wrap(ship.x, ARENA.width), y: wrap(ship.y, ARENA.height) };
}

function interpolateWrapped(from: number, to: number, alpha: number, size: number) {
  const delta = wrap(to - from + size / 2, size) - size / 2;
  return wrap(from + delta * alpha, size);
}

export function interpolateShip<T extends Pose>(previous: Pose, current: T, alpha: number): T {
  return {
    ...current,
    x: interpolateWrapped(previous.x, current.x, alpha, ARENA.width),
    y: interpolateWrapped(previous.y, current.y, alpha, ARENA.height),
    angle: interpolateWrapped(previous.angle, current.angle, alpha, 2 * Math.PI),
  };
}
