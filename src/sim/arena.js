export const ARENA = { width: 1000, height: 600 };

export function wrap(value, size) {
  return ((value % size) + size) % size;
}

export function wrapShip(ship) {
  return { ...ship, x: wrap(ship.x, ARENA.width), y: wrap(ship.y, ARENA.height) };
}

function interpolateWrapped(from, to, alpha, size) {
  const delta = wrap(to - from + size / 2, size) - size / 2;
  return wrap(from + delta * alpha, size);
}

export function interpolateShip(previous, current, alpha) {
  return {
    ...current,
    x: interpolateWrapped(previous.x, current.x, alpha, ARENA.width),
    y: interpolateWrapped(previous.y, current.y, alpha, ARENA.height),
    angle: interpolateWrapped(previous.angle, current.angle, alpha, 2 * Math.PI),
  };
}
