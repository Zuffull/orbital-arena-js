import { createInput } from "./input.ts";
import { createLoop } from "./loop.ts";
import { createCanvas } from "./render/canvas.ts";
import { drawArena, drawHud, drawShip } from "./render/draw.ts";
import { interpolateShip, wrapShip } from "../../shared/sim/arena.ts";
import { createShip, integrate } from "../../shared/sim/ship.ts";

import { requireElement } from "./dom.ts";
import type { FrameStats } from "./loop.ts";

const canvas = createCanvas(requireElement("#arena", HTMLCanvasElement));
const hud = requireElement("#hud", HTMLElement);
const keyboard = createInput(window);
const params = new URLSearchParams(location.search);
const experiment = params.get("experiment");
const auto = params.has("auto");
let current = createShip();
let previous = current;
let frames = 0;
let simulationTime = 0;
let totalSteps = 0;
let startedAt: number | undefined;
const frameTimes: number[] = [];

function reset() {
  current = createShip();
  previous = current;
}

requireElement("#reset", HTMLElement).addEventListener("click", reset);

function simulate(dt: number) {
  if (keyboard.justPressed("KeyR")) reset();
  previous = current;
  const left = keyboard.isDown("KeyA") || keyboard.isDown("ArrowLeft");
  const right = keyboard.isDown("KeyD") || keyboard.isDown("ArrowRight");
  const thrust = auto || keyboard.isDown("KeyW") || keyboard.isDown("ArrowUp");
  const turn = auto ? 0.35 : Number(right) - Number(left);
  const activeDt = auto ? Math.min(dt, Math.max(0, 5 - simulationTime)) : dt;
  if (activeDt > 1e-10) {
    current = wrapShip(integrate(current, { turn, thrust }, activeDt));
    simulationTime += activeDt;
    totalSteps++;
  }
}

function render(alpha: number, stats: FrameStats) {
  const ctx = canvas.prepare();
  drawArena(ctx);
  drawShip(ctx, interpolateShip(previous, current, alpha));
  drawHud(hud, stats);
  frames++;
  if (experiment === "block" && frames % 60 === 0) {
    const deadline = performance.now() + 100;
    while (performance.now() < deadline) {
      // This deliberately stalls the main thread for Lab 01.
    }
  }
}

function onFrame(frameMs: number) {
  if (!experiment) return;
  startedAt ??= performance.now();
  frameTimes.push(frameMs);
  if (performance.now() - startedAt >= 10_000) {
    loop.stop();
    const mean = frameTimes.reduce((sum, ms) => sum + ms, 0) / frameTimes.length;
    const variance = frameTimes.reduce((sum, ms) => sum + (ms - mean) ** 2, 0) / frameTimes.length;
    const result = {
      experiment,
      frames: frameTimes.length,
      fps: 1000 / mean,
      meanFrameMs: mean,
      jitterMs: Math.sqrt(variance),
      maxFrameMs: frameTimes.reduce((max, ms) => Math.max(max, ms), 0),
      x: current.x,
      y: current.y,
      totalSteps,
      simulationTime,
    };
    document.body.dataset.result = JSON.stringify(result);
    console.table(result);
  }
}

const mode = experiment === "interval" || experiment === "variable" ? experiment : "fixed";
const loop = createLoop({ mode, simulate, render, onFrame });
loop.start();
