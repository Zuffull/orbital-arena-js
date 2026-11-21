import { drawEntity } from "./local-game.js";
import { ARENA } from "../../shared/sim/arena.js";

const columns = { ship: 0, bullet: 1, asteroid: 2 };

export function createSpriteRenderer(sheet) {
  function paint(ctx, entity, pose, x, y) {
    const size = entity.kind === "ship" ? 34 : entity.radius * 2;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(pose.angle);
    if (entity.kind === "ship" && pose.thrust) {
      ctx.fillStyle = "#ffb365";
      ctx.beginPath();
      ctx.moveTo(-10, -4);
      ctx.lineTo(-26, 0);
      ctx.lineTo(-10, 4);
      ctx.fill();
    }
    ctx.drawImage(sheet, columns[entity.kind] * 32, 0, 32, 32, -size / 2, -size / 2, size, size);
    const marker = entity.shield ? "#56efa9" : entity.behavior ? "#e69bff"
      : entity.kind === "ship" && entity.owner === "drone" ? "#ffab81" : null;
    if (marker) {
      ctx.beginPath();
      ctx.arc(0, 0, size / 2 + 2, 0, 2 * Math.PI);
      ctx.strokeStyle = marker;
      ctx.stroke();
    }
    ctx.restore();
  }
  return (ctx, entity, pose) => {
    if (columns[entity.kind] === undefined) {
      drawEntity(ctx, entity, pose);
      return;
    }
    const xs = [pose.x];
    const ys = [pose.y];
    if (entity.kind !== "asteroid") {
      if (pose.x < 28) xs.push(pose.x + ARENA.width);
      if (pose.x > ARENA.width - 28) xs.push(pose.x - ARENA.width);
      if (pose.y < 28) ys.push(pose.y + ARENA.height);
      if (pose.y > ARENA.height - 28) ys.push(pose.y - ARENA.height);
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, ARENA.width, ARENA.height);
    ctx.clip();
    for (const x of xs) for (const y of ys) paint(ctx, entity, pose, x, y);
    ctx.restore();
  };
}
