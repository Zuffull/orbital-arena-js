import { ARENA } from "../sim/arena.js";

export function drawArena(ctx) {
  ctx.fillStyle = "#101e34";
  ctx.fillRect(0, 0, ARENA.width, ARENA.height);
  ctx.strokeStyle = "#233951";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 50; x < ARENA.width; x += 50) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, ARENA.height);
  }
  for (let y = 50; y < ARENA.height; y += 50) {
    ctx.moveTo(0, y);
    ctx.lineTo(ARENA.width, y);
  }
  ctx.stroke();
  ctx.strokeRect(0.5, 0.5, ARENA.width - 1, ARENA.height - 1);
}

export function drawShip(ctx, ship, color = "#78dfff") {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, ARENA.width, ARENA.height);
  ctx.clip();
  const offsetsX = [0];
  const offsetsY = [0];
  if (ship.x < 28) offsetsX.push(ARENA.width);
  if (ship.x > ARENA.width - 28) offsetsX.push(-ARENA.width);
  if (ship.y < 28) offsetsY.push(ARENA.height);
  if (ship.y > ARENA.height - 28) offsetsY.push(-ARENA.height);
  for (const x of offsetsX) {
    for (const y of offsetsY) drawHull(ctx, ship, x, y, color);
  }
  ctx.restore();
}

function drawHull(ctx, ship, x, y, color) {
  ctx.save();
  ctx.translate(ship.x + x, ship.y + y);
  ctx.rotate(ship.angle);
  if (ship.thrust) {
    ctx.fillStyle = "#ffb365";
    ctx.beginPath();
    ctx.moveTo(-10, -4);
    ctx.lineTo(-26, 0);
    ctx.lineTo(-10, 4);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(17, 0);
  ctx.lineTo(-12, -10);
  ctx.lineTo(-7, 0);
  ctx.lineTo(-12, 10);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

export function drawHud(element, stats) {
  element.textContent =
    `${stats.stepsPerSecond.toFixed(0)} steps/s · ${stats.fps.toFixed(0)} frames/s · ${stats.frameMs.toFixed(1)} ms`;
}
