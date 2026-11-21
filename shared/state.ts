import type { SimEntity } from "./sim/entity.ts";
import { unreachable, ZERO_SEQ, type SnapshotEntity } from "./protocol.ts";

export function entityState(entity: SimEntity, owner: string): SnapshotEntity {
  const base = {
    id: entity.id, self: entity.owner === owner,
    thrust: entity.kind === "ship" && entity.thrust,
    shield: entity.kind === "ship" && entity.shield,
    homing: Boolean(entity.behavior),
    x: entity.pos.x, y: entity.pos.y, vx: entity.vel.x, vy: entity.vel.y, angle: entity.angle,
    radius: entity.radius,
    hp: entity.kind === "ship" || entity.kind === "asteroid" ? entity.hp : 0,
    cooldown: entity.kind === "ship" ? entity.cooldown : 0,
    shotSeq: entity.kind === "bullet" ? entity.shotSeq : ZERO_SEQ,
  };
  switch (entity.kind) {
    case "ship": return { ...base, kind: entity.kind };
    case "bullet": return { ...base, kind: entity.kind };
    case "asteroid": return { ...base, kind: entity.kind };
    case "pickup": return { ...base, kind: entity.kind };
    case "explosion": return { ...base, kind: entity.kind };
    default: return unreachable(entity);
  }
}
