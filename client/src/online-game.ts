import { DT, sequence as inputSequence, tickNumber, ZERO_SEQ, type EntityId, type Input, type Seq, type SnapshotEntity } from "../../shared/protocol.ts";
import { wrapShip } from "../../shared/sim/arena.ts";
import { createInput } from "./input.ts";
import { createLoop } from "./loop.ts";
import { advance, delta, snapshots } from "./prediction.ts";
import { createCanvas } from "./render/canvas.ts";
import { drawArena, drawHud, drawShip } from "./render/draw.ts";

import { requireElement } from "./dom.ts";
import type { FrameStats } from "./loop.ts";
import type { RenderSprite } from "./local-game.ts";
import type { Connection, RoomPacket } from "./network.ts";
import type { PredictedBullet, SnapshotShip } from "./prediction.ts";
import type { Sound } from "./audio.ts";

export function startOnline(connection: Connection, drawEntity: RenderSprite, sound: (name: Sound) => void) {
  const params = new URLSearchParams(location.search);
  const predict = !params.has("snapshot-only");
  const drift = params.has("drift");
  const canvas = createCanvas(requireElement("#arena", HTMLCanvasElement));
  const hud = requireElement("#hud", HTMLElement);
  const status = requireElement("#status", HTMLElement);
  const graph = requireElement("#netgraph", HTMLElement);
  const slider = requireElement("#interpolation", HTMLInputElement);
  const keyboard = createInput(window);
  const history = snapshots();
  const bullets = new Map<Seq, PredictedBullet>();
  const held = (code: string) => keyboard.isDown(code);
  let pending: Input[] = [];
  let ship: SnapshotShip | undefined;
  let tick = tickNumber.parse(0), sequence = ZERO_SEQ, received = 0, score = 0;
  let correctionAt = 0, correctionSize = 0;
  let explosions = new Set<EntityId>();
  const zero = () => ({ x: 0, y: 0 });
  let correction = zero();

  function reset() {
    history.clear();
    bullets.clear();
    pending = [];
    ship = undefined;
    tick = tickNumber.parse(0);
    sequence = ZERO_SEQ;
    received = 0;
    score = 0;
    correction = zero();
    correctionAt = 0;
    correctionSize = 0;
    explosions = new Set();
  }
  reset();

  function displayed(now: number) {
    if (!ship) return undefined;
    const weight = Math.max(0, 1 - (now - correctionAt) / 100);
    return wrapShip({ ...ship, x: ship.x + correction.x * weight, y: ship.y + correction.y * weight });
  }

  function receive(packet: RoomPacket) {
    if (packet.type === "joined") reset();
    if (packet.type !== "snapshot" || packet.tick <= tick) return;
    tick = packet.tick;
    received = performance.now();
    score = packet.score;
    history.push(packet, received);
    pending = pending.filter(input => input.seq > packet.ack);
    for (const key of bullets.keys()) if (key <= packet.ack) bullets.delete(key);
    const authority = packet.entities.find((entity): entity is SnapshotShip => entity.self && entity.kind === "ship");
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

  function simulate(dt: number) {
    if (pending.length >= 96) return;
    const homing = keyboard.justPressed("KeyH") || held("KeyH");
    const left = held("KeyA") || held("ArrowLeft");
    const right = held("KeyD") || held("ArrowRight");
    const input: Input = {
      type: "input", seq: inputSequence.parse((sequence + 1) >>> 0 || 1),
      turn: left === right ? 0 : right ? 1 : -1,
      thrust: held("KeyW") || held("ArrowUp"),
      fire: keyboard.justPressed("Space") || held("Space") || homing, homing,
    };
    if (!connection.sendInput(input)) return;
    sequence = input.seq;
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

  function paint(ctx: CanvasRenderingContext2D, entity: SnapshotEntity | PredictedBullet) {
    if (entity.kind !== "explosion") {
      drawEntity(ctx, { ...entity, owner: !("self" in entity) || entity.self ? "player" : "drone",
        behavior: entity.homing }, entity);
      return;
    }
    ctx.beginPath();
    ctx.arc(entity.x, entity.y, 18, 0, 2 * Math.PI);
    ctx.strokeStyle = "#ffb063";
    ctx.stroke();
  }

  function render(_alpha: number, stats: FrameStats) {
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
    graph.dataset.tick = String(tick);
    graph.dataset.correction = correctionSize.toFixed(3);
    graph.dataset.selfX = self?.x.toFixed(3) ?? "";
    graph.dataset.selfY = self?.y.toFixed(3) ?? "";
    drawHud(hud, stats);
  }

  const loop = createLoop({ step: DT, simulate, render });
  loop.start();
  return { receive, stop() { keyboard.destroy(); loop.stop(); } };
}
