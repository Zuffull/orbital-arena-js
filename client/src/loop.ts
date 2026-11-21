export interface FrameStats { fps: number; stepsPerSecond: number; frameMs: number; }
interface LoopOptions {
  step?: number;
  simulate(dt: number): void;
  render(alpha: number, stats: FrameStats): void;
  mode?: "fixed" | "variable" | "interval";
  onFrame?(frameMs: number): void;
}

export function createLoop({
  step = 1 / 60,
  simulate,
  render,
  mode = "fixed",
  onFrame = () => {},
}: LoopOptions) {
  let active = false;
  let scheduled: number | undefined;
  let last: number | null = null;
  let accumulator = 0;
  let elapsed = 0;
  let frames = 0;
  let steps = 0;
  let stats = { fps: 0, stepsPerSecond: 0, frameMs: 0 };

  function frame(now: number) {
    if (!active) return;
    const delta = last === null ? 0 : (now - last) / 1000;
    last = now;
    const clamped = Math.min(delta, 0.25);
    if (mode === "variable") {
      if (clamped > 0) {
        simulate(clamped);
        steps++;
      }
    } else {
      accumulator += clamped;
      while (accumulator + 1e-10 >= step) {
        simulate(step);
        accumulator -= step;
        steps++;
      }
    }
    frames += Number(delta > 0);
    elapsed += delta;
    if (elapsed >= 0.5) {
      stats = { fps: frames / elapsed, stepsPerSecond: steps / elapsed, frameMs: 0 };
      elapsed = 0;
      frames = 0;
      steps = 0;
    }
    stats.frameMs = delta * 1000;
    render(mode === "variable" ? 1 : Math.max(0, accumulator / step), stats);
    if (delta > 0) onFrame(stats.frameMs);
    if (active && mode !== "interval") scheduled = requestAnimationFrame(frame);
  }

  function start() {
    if (active) return;
    last = null;
    accumulator = 0;
    elapsed = 0;
    frames = 0;
    steps = 0;
    stats = { fps: 0, stepsPerSecond: 0, frameMs: 0 };
    active = true;
    scheduled =
      mode === "interval"
        ? window.setInterval(() => frame(performance.now()), 16)
        : requestAnimationFrame(frame);
  }

  function stop() {
    active = false;
    if (mode === "interval") clearInterval(scheduled);
    else if (scheduled !== undefined) cancelAnimationFrame(scheduled);
  }

  return { start, stop };
}
