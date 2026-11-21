import { ARENA } from "../sim/arena.js";

export function createCanvas(canvas) {
  const ctx = canvas.getContext("2d");
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
  }

  function prepare() {
    resize();
    const scale = Math.min(canvas.width / ARENA.width, canvas.height / ARENA.height);
    ctx.resetTransform();
    ctx.fillStyle = "#080f1d";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(
      scale, 0, 0, scale,
      (canvas.width - ARENA.width * scale) / 2,
      (canvas.height - ARENA.height * scale) / 2,
    );
    return ctx;
  }

  return { prepare };
}
