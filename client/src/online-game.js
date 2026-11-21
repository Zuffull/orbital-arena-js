import { DT } from "../../shared/protocol.js";
import { wrapShip } from "../../shared/sim/arena.js";
import { createInput } from "./input.js";
import { createLoop } from "./loop.js";
import { advance, delta, snapshots } from "./prediction.js";
import { createCanvas } from "./render/canvas.js";
import { drawArena, drawHud, drawShip } from "./render/draw.js";

export function startOnline(connection, drawEntity, sound) {
  const params = new URLSearchParams(location.search);
  const predict = !params.has("snapshot-only");
  const drift = params.has("drift");
  const canvas = createCanvas(document.querySelector("#arena"));
  const hud = document.querySelector("#hud");
  const status = document.querySelector("#status");
  const graph = document.querySelector("#netgraph");
  const slider = document.querySelector("#interpolation");
  const keyboard = createInput(window);
  const history = snapshots();
  const bullets = new Map();
  const held = code => keyboard.isDown(code);
  let pending = [];
  let ship, tick, sequence, received, score, correction, correctionAt, correctionSize, explosions;
  const zero = () => ({ x: 0, y: 0 });

  function reset() {
    history.clear();
    bullets.clear();
    pending = [];
    ship = undefined;
    tick = 0;
    sequence = 0;
    received = 0;
    score = 0;
    correction = zero();
    correctionAt = 0;
    correctionSize = 0;
    explosions = new Set();
  }
  reset();

  function displayed(now) {
    if (!ship) return undefined;
    const weight = Math.max(0, 1 - (now - correctionAt) / 100);
    return wrapShip({ ...ship, x: ship.x + correction.x * weight, y: ship.y + correction.y * weight });
  }

  function receive(packet) {
    if (packet.type === "joined") reset();
    if (packet.type !== "snapshot" || packet.tick <= tick) return;
    tick = packet.tick;
    received = performance.now();
    score = packet.score;
    history.push(packet, received);
    pending = pending.filter(input => input.seq > packet.ack);
    for (const key of bullets.keys()) if (key <= packet.ack) bullets.delete(key);
    const authority = packet.entities.find(entity => entity.self && entity.kind === "ship");
    const before = displayed(received);
    const predicted = authority && predict ? pending.reduce((value, cmd) => advance(value, cmd).ship, authority) : authority;
    if (predict && before && predicted && before.id === predicted.id) {
      correction = delta(before, predicted);
      correctionAt = received;
      correctionSize = Math.hypot(correction.x, correction.y);
      if (predicted.hp < before.hp) sound("hit");
    } else {
      correction = zero();
      correctionSize = 0;
    }
    ship = predicted;
    const next = new Set(packet.entities.filter(e => e.kind === "explosion").map(e => e.id));
    if ([...next].some(id => !explosions.has(id))) sound("exploded");
    explosions = next;
  }

  function simulate(dt) {
    if (pending.length >= 96) return;
    const homing = keyboard.justPressed("KeyH") || held("KeyH");
    const input = {
      type: "input", seq: sequence + 1,
      turn: Number(held("KeyD") || held("ArrowRight")) - Number(held("KeyA") || held("ArrowLeft")),
      thrust: held("KeyW") || held("ArrowUp"),
      fire: keyboard.justPressed("Space") || held("Space") || homing, homing,
    };
    if (!connection.sendInput(input)) return;
    sequence++;
    pending.push(input);
    for (const [seq, bullet] of bullets) {
      bullet.life -= dt;
      if (bullet.life <= 0) bullets.delete(seq);
      else bullets.set(seq, wrapShip({ ...bullet, x: bullet.x + bullet.vx * dt, y: bullet.y + bullet.vy * dt }));
    }
    if (!ship || !predict) return;
    const next = advance(ship, input);
    ship = next.ship;
    if (drift) ship = wrapShip({ ...ship, x: ship.x + (Math.random() - 0.5) * 26 });
    if (next.bullet) {
      bullets.set(input.seq, next.bullet);
      sound("fired");
    }
  }

  function paint(ctx, entity) {
    if (entity.kind !== "explosion") {
      drawEntity(ctx, { ...entity, owner: entity.self ? "player" : "drone",
        behavior: entity.homing }, entity);
      return;
    }
    ctx.beginPath();
    ctx.arc(entity.x, entity.y, 18, 0, 2 * Math.PI);
    ctx.strokeStyle = "#ffb063";
    ctx.stroke();
  }

  function render(_alpha, stats) {
    const ctx = canvas.prepare();
    drawArena(ctx);
    const now = performance.now();
    const delay = Number(slider.value);
    for (const entity of history.at(now - delay)) {
      if (!entity.self) paint(ctx, entity);
    }
    for (const entity of history.at(now)) {
      if (entity.self && entity.kind !== "ship") paint(ctx, entity);
    }
    for (const bullet of bullets.values()) paint(ctx, bullet);
    const self = displayed(now);
    if (self) drawShip(ctx, self, self.shield ? "#56efa9" : "#78dfff");
    status.textContent = self ? `HP ${self.hp} · Рахунок ${score}` : `Очікування корабля · Рахунок ${score}`;
    const { rtt, bps } = connection.metrics();
    const age = received ? Math.round(now - received + (rtt || 0) / 2) : 0;
    graph.textContent = `${predict ? "Prediction" : "Snapshot-only"} · RTT ${rtt === null ? "—" : Math.round(rtt)} ms · вік ${age} ms · ${bps} B/s · input ${pending.length} · Δ ${correctionSize.toFixed(2)} px · буфер ${delay} ms`;
    graph.dataset.tick = tick;
    graph.dataset.correction = correctionSize.toFixed(3);
    graph.dataset.selfX = self?.x.toFixed(3) ?? "";
    graph.dataset.selfY = self?.y.toFixed(3) ?? "";
    drawHud(hud, stats);
  }

  const loop = createLoop({ step: DT, simulate, render });
  loop.start();
  return { receive, stop() { keyboard.destroy(); loop.stop(); } };
}
