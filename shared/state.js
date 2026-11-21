export function entityState(entity, owner) {
  return {
    id: entity.id, kind: entity.kind, self: entity.owner === owner,
    thrust: Boolean(entity.thrust), shield: Boolean(entity.shield), homing: Boolean(entity.behavior),
    x: entity.pos.x, y: entity.pos.y, vx: entity.vel.x, vy: entity.vel.y, angle: entity.angle,
    radius: entity.radius, hp: entity.hp ?? 0, cooldown: entity.cooldown ?? 0, shotSeq: entity.shotSeq ?? 0,
  };
}
