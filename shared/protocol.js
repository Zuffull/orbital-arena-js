export const VERSION = 1;
export const DT = 1 / 30;
export const KINDS = ["ship", "bullet", "asteroid", "pickup", "explosion"];
export const IDLE = Object.freeze({ seq: 0, turn: 0, thrust: false, fire: false, homing: false });
export const isUint32 = n => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;

export function validInput(input) {
  return input?.type === "input" && isUint32(input.seq) && input.seq > 0 &&
    [-1, 0, 1].includes(input.turn) && ["thrust", "fire", "homing"].every(key => typeof input[key] === "boolean");
}

export function readInput(value) {
  if (!validInput(value)) return null;
  const { seq, turn, thrust, fire, homing } = value;
  return { type: "input", seq, turn, thrust, fire, homing };
}
