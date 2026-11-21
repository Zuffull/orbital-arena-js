import { DT, type Input, type Snapshot, type SnapshotEntity } from "../../shared/protocol.ts";
import { ARENA, interpolateShip, wrap, wrapShip } from "../../shared/sim/arena.ts";
import { integrate, shotFrom } from "../../shared/sim/ship.ts";

export type PredictedBullet = ReturnType<typeof shotFrom> & {
  kind: "bullet"; radius: number; angle: number; homing: boolean; shotSeq: Input["seq"]; life: number;
};
export type SnapshotShip = Extract<SnapshotEntity, { kind: "ship" }>;

export function advance(ship: SnapshotShip, input: Input): { ship: SnapshotShip; bullet?: PredictedBullet } {
  const next = { ...ship, ...wrapShip(integrate(ship, input, DT)),
    cooldown: Math.max(0, ship.cooldown - DT) };
  if (!input.fire || next.cooldown > 0) return { ship: next };
  next.cooldown = 0.22;
  return { ship: next, bullet: { ...shotFrom(next), kind: "bullet", radius: 4,
    angle: next.angle, homing: input.homing, shotSeq: input.seq, life: 0.85 } };
}

export function delta(from: { x: number; y: number }, to: { x: number; y: number }) {
  return {
    x: wrap(from.x - to.x + ARENA.width / 2, ARENA.width) - ARENA.width / 2,
    y: wrap(from.y - to.y + ARENA.height / 2, ARENA.height) - ARENA.height / 2,
  };
}

export function snapshots() {
  const frames: (Snapshot & { at: number })[] = [];
  return {
    clear() { frames.length = 0; },
    push(snapshot: Snapshot, time: number) {
      const last = frames.at(-1);
      if (last && snapshot.tick <= last.tick) return;
      const at = last ? last.at + (snapshot.tick - last.tick) * DT * 1000 : time;
      frames.push({ ...snapshot, at });
      if (frames.length > 40) frames.shift();
    },
    at(time: number): SnapshotEntity[] {
      if (!frames.length) return [];
      const i = frames.findIndex(frame => frame.at > time);
      if (i < 0) return frames.at(-1)?.entities ?? [];
      if (!i) return frames[0]?.entities ?? [];
      const a = frames[i - 1], b = frames[i];
      if (!a || !b) return [];
      const target = new Map(b.entities.map(entity => [entity.id, entity]));
      const alpha = (time - a.at) / (b.at - a.at);
      return a.entities.map(entity => {
        const next = target.get(entity.id);
        return next ? interpolateShip(entity, next, alpha) : entity;
      });
    },
  };
}
