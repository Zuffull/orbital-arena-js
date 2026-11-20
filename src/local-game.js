import { createInput } from "./input.js";
import { createLoop } from "./loop.js";
import { createCanvas } from "./render/canvas.js";
import { drawArena, drawHud, drawShip } from "./render/draw.js";
import { interpolateShip } from "./sim/arena.js";
import { Vector2 } from "./sim/vector.js";
import { World } from "./sim/world.js";

export function drawEntity(ctx, entity, pose) {
  if (entity.kind === "ship") {
    const color = entity.owner === "player" ? "#78dfff" : "#ffab81";
    drawShip(ctx, pose, entity.shield ? "#56efa9" : color);
    return;
  }
  if (entity.kind === "explosion") {
    ctx.fillStyle = "#ffb063";
    for (const { pos } of entity.particles) ctx.fillRect(pos.x, pos.y, 3, 3);
    return;
  }
  ctx.beginPath();
  if (entity.kind === "pickup") {
    ctx.moveTo(pose.x, pose.y - entity.radius);
    ctx.lineTo(pose.x + entity.radius, pose.y);
    ctx.lineTo(pose.x, pose.y + entity.radius);
    ctx.lineTo(pose.x - entity.radius, pose.y);
    ctx.closePath();
  } else {
    ctx.arc(pose.x, pose.y, entity.radius, 0, Math.PI * 2);
  }
  const colors = { bullet: "#ffd674", asteroid: "#88758e", pickup: "#56efa9" };
  ctx.fillStyle = entity.behavior ? "#e69bff" : colors[entity.kind];
  ctx.fill();
}

export function pose(entity) {
  return { x: entity.pos.x, y: entity.pos.y, angle: entity.angle, thrust: entity.thrust };
}

export function startLocalGame({ onEvent = () => {}, renderEntity = drawEntity } = {}) {
  const canvas = createCanvas(document.querySelector("#arena"));
  const hud = document.querySelector("#hud");
  const status = document.querySelector("#status");
  const reset = document.querySelector("#reset");
  const keyboard = createInput(window);
  let world;
  let previous = new Map();

  function initialize() {
    world = new World();
    world.populate();
    world.addPlayer("player", 0, new Vector2(500, 300));
    world.addPlayer("drone", 0, new Vector2(840, 300));
    previous = new Map();
  }

  function simulate(dt) {
    if (keyboard.justPressed("KeyR")) initialize();
    previous = new Map([...world].map(entity => [entity.id, pose(entity)]));
    const left = keyboard.isDown("KeyA") || keyboard.isDown("ArrowLeft");
    const right = keyboard.isDown("KeyD") || keyboard.isDown("ArrowRight");
    const homing = keyboard.justPressed("KeyH") || keyboard.isDown("KeyH");
    const fire = keyboard.justPressed("Space") || keyboard.isDown("Space");
    world.step(dt, new Map([["player", {
      turn: Number(right) - Number(left),
      thrust: keyboard.isDown("KeyW") || keyboard.isDown("ArrowUp"),
      fire: fire || homing,
      homing,
    }]]));
    for (const event of world.drainEvents()) onEvent(event);
  }

  function render(alpha, stats) {
    const ctx = canvas.prepare();
    drawArena(ctx);
    for (const entity of world) {
      const current = pose(entity);
      renderEntity(ctx, entity, interpolateShip(previous.get(entity.id) || current, current, alpha));
    }
    const ship = [...world.ofKind("ship")].find(entity => entity.owner === "player");
    const shield = ship?.shield ? " · Щит" : "";
    status.textContent = ship ? `HP ${ship.hp} · Рахунок ${ship.score}${shield}` : "Відродження…";
    drawHud(hud, stats);
  }

  initialize();
  reset.addEventListener("click", initialize);
  const loop = createLoop({ simulate, render });
  loop.start();
  return () => {
    loop.stop();
    keyboard.destroy();
    reset.removeEventListener("click", initialize);
  };
}
