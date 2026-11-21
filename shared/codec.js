import { isUint32, KINDS, readInput, VERSION } from "./protocol.js";

const HEADER = 16;
const ENTITY = 32;
const TAU = Math.PI * 2;
const SCALE = 32768 / Math.PI;
const view = bytes => bytes instanceof ArrayBuffer ? new DataView(bytes) :
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

export function encodeInput(input) {
  if (!readInput(input)) throw new RangeError("Invalid input");
  const data = new DataView(new ArrayBuffer(8));
  data.setUint8(0, VERSION);
  data.setUint8(1, 1);
  data.setUint32(2, input.seq, true);
  data.setInt8(6, input.turn);
  data.setUint8(7, Number(input.thrust) | (Number(input.fire) << 1) | (Number(input.homing) << 2));
  return data.buffer;
}

export function decodeInput(bytes) {
  const data = view(bytes);
  if (data.byteLength !== 8 || data.getUint8(0) !== VERSION || data.getUint8(1) !== 1 || data.getUint8(7) > 7) {
    throw new RangeError("Invalid input packet");
  }
  const flags = data.getUint8(7);
  const input = readInput({
    type: "input", seq: data.getUint32(2, true), turn: data.getInt8(6),
    thrust: Boolean(flags & 1), fire: Boolean(flags & 2), homing: Boolean(flags & 4),
  });
  if (!input) throw new RangeError("Invalid input fields");
  return input;
}

export function encodeSnapshot({ tick, ack, score, entities }) {
  if (![tick, ack, score].every(isUint32) || entities.length > 1024) throw new RangeError("Invalid snapshot");
  const data = new DataView(new ArrayBuffer(HEADER + ENTITY * entities.length));
  data.setUint8(0, VERSION);
  data.setUint8(1, 2);
  data.setUint32(2, tick, true);
  data.setUint32(6, ack, true);
  data.setUint32(10, score, true);
  data.setUint16(14, entities.length, true);
  for (const [i, entity] of entities.entries()) {
    const offset = HEADER + i * ENTITY;
    const kind = KINDS.indexOf(entity.kind);
    if (kind < 0 || !isUint32(entity.id) || entity.id === 0) throw new RangeError("Invalid entity");
    data.setUint32(offset, entity.id, true);
    data.setUint8(offset + 4, kind);
    data.setUint8(offset + 5, Number(entity.self) | (Number(entity.thrust) << 1) |
      (Number(entity.shield) << 2) | (Number(entity.homing) << 3));
    data.setFloat32(offset + 6, entity.x, true);
    data.setFloat32(offset + 10, entity.y, true);
    data.setFloat32(offset + 14, entity.vx, true);
    data.setFloat32(offset + 18, entity.vy, true);
    data.setInt16(offset + 22, Math.round(entity.angle * SCALE), true);
    data.setUint8(offset + 24, entity.radius);
    data.setUint8(offset + 25, entity.hp);
    data.setUint16(offset + 26, Math.round(entity.cooldown * 1000), true);
    data.setUint32(offset + 28, entity.shotSeq, true);
  }
  return data.buffer;
}

export function decodeSnapshot(bytes) {
  const data = view(bytes);
  if (data.byteLength < HEADER || data.getUint8(0) !== VERSION || data.getUint8(1) !== 2) {
    throw new RangeError("Invalid snapshot header");
  }
  const count = data.getUint16(14, true);
  if (count > 1024 || data.byteLength !== HEADER + ENTITY * count) throw new RangeError("Invalid snapshot length");
  const entities = [];
  for (let offset = HEADER; offset < data.byteLength; offset += ENTITY) {
    const flags = data.getUint8(offset + 5);
    const angle = data.getInt16(offset + 22, true) / SCALE;
    const entity = {
      id: data.getUint32(offset, true), kind: KINDS[data.getUint8(offset + 4)],
      self: Boolean(flags & 1), thrust: Boolean(flags & 2), shield: Boolean(flags & 4), homing: Boolean(flags & 8),
      x: data.getFloat32(offset + 6, true), y: data.getFloat32(offset + 10, true),
      vx: data.getFloat32(offset + 14, true), vy: data.getFloat32(offset + 18, true),
      angle: angle < 0 ? angle + TAU : angle, radius: data.getUint8(offset + 24),
      hp: data.getUint8(offset + 25), cooldown: data.getUint16(offset + 26, true) / 1000,
      shotSeq: data.getUint32(offset + 28, true),
    };
    if (!entity.id || !entity.kind || flags > 15 || ![entity.x, entity.y, entity.vx, entity.vy].every(Number.isFinite)) {
      throw new RangeError("Invalid snapshot entity");
    }
    entities.push(entity);
  }
  return { v: VERSION, type: "snapshot", tick: data.getUint32(2, true),
    ack: data.getUint32(6, true), score: data.getUint32(10, true), entities };
}
