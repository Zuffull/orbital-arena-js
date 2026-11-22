import { writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "@playwright/test";
import { createRoom, joinBot, localOrigin } from "./bots.mjs";

const origin = localOrigin(process.env.ORIGIN ?? "http://127.0.0.1:3000");
const prefix = process.argv[2] ?? "docs/lab-07-after";
const q = (a, p) => a.toSorted((x, y) => x - y)[Math.ceil(a.length * p) - 1] ?? 0;
const quantiles = a => [q(a, .5), q(a, .95), q(a, .99)];
const escape = s => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
function flame({ nodes, samples, timeDeltas }) {
  const parents = new Map(nodes.flatMap(n => (n.children ?? []).map(c => [c, n.id])));
  const names = new Map(nodes.map(n => [n.id, n.callFrame.functionName || "(anonymous)"]));
  let best = 0, busy = 0;
  for (let index = 0; index < samples.length; index += 80) {
    const count = samples.slice(index, index + 180).filter(id => names.get(id) !== "(idle)").length;
    if (count > busy) { best = index; busy = count; }
  }
  const slice = samples.slice(best, best + 180), deltas = timeDeltas.slice(best, best + 180);
  const total = deltas.reduce((n, d) => n + Math.max(0, d), 0);
  let x = 24;
  const boxes = [];
  for (const [i, sample] of slice.entries()) {
    const stack = [];
    for (let id = sample; id; id = parents.get(id)) stack.unshift(id);
    const w = 950 * Math.max(0, deltas[i]) / total;
    for (const [row, id] of stack.slice(0, 14).entries()) {
      const y = 70 + row * 21, key = row + ":" + id;
      const previous = boxes.findLast(box => box.row === row);
      if (previous?.key === key && Math.abs(previous.x + previous.w - x) < .01) previous.w += w;
      else boxes.push({ x, y, w, row, key, name: names.get(id), id });
    }
    x += w;
  }
  const palette = ["#fbc56b", "#a2c5ff", "#87cfbc", "#f29e93", "#c8b7ff"];
  const chart = boxes.map(({ x, y, w, id, name }) =>
    `<rect x="${x}" y="${y}" width="${w}" height="20" fill="${palette[id % palette.length]}"><title>${escape(name)}</title></rect>` +
    (w > 60 ? `<text x="${x + 3}" y="${y + 14}" font-size="10">${escape(name.slice(0, Math.floor(w / 6)))}</text>` : "")).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="370" font-family="system-ui"><rect width="1000" height="370" fill="#172237"/><text x="24" y="27" fill="white" font-size="20">Chrome DevTools CPU profile · 8 bots</text><text x="24" y="50" fill="white" font-size="13">Call stacks over a selected ${(total / 1000).toFixed(1)} ms window</text>${chart}</svg>`;
}
const browser = await chromium.launch();
const stops = [];
try {
  const { id } = await createRoom(origin, "Lab 07 profile");
  for (let slot = 1; slot <= 7; slot++) stops.push(await joinBot(origin, id, slot));
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
  await page.goto(origin);
  await page.locator("#load-start").click();
  await page.locator("[name=player]").fill("Bot 8");
  await page.locator("[name=room]").selectOption(id);
  await page.locator("#lobby button").click();
  await page.waitForFunction(() => Number(document.querySelector("#netgraph").dataset.tick) > 5);
  const cdp = await page.context().newCDPSession(page);
  const trace = [];
  cdp.on("Tracing.dataCollected", ({ value }) => { for (const event of value) trace.push(event); });
  const tracingDone = new Promise(resolve => cdp.once("Tracing.tracingComplete", resolve));
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 1000 });
  await cdp.send("HeapProfiler.startSampling", { samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  await cdp.send("Profiler.start");
  await cdp.send("Tracing.start", { categories: "devtools.timeline,v8,disabled-by-default-v8.gc", transferMode: "ReportEvents" });
  await page.evaluate(() => {
    window.lab07Frames = [];
    let last;
    function frame(time) {
      if (last !== undefined) window.lab07Frames.push(time - last);
      last = time;
      window.lab07Raf = requestAnimationFrame(frame);
    }
    window.lab07Raf = requestAnimationFrame(frame);
  });
  const start = performance.now();
  for (let phase = 0; phase < 12; phase++) {
    const turn = phase % 2 ? "d" : "a", fire = phase % 3 ? "Space" : "h";
    for (const key of ["w", turn, fire]) await page.keyboard.down(key);
    await sleep(Math.max(0, start + (phase + 1) * 2500 - performance.now()));
    for (const key of ["w", turn, fire]) await page.keyboard.up(key);
  }
  const frames = await page.evaluate(() => {
    cancelAnimationFrame(window.lab07Raf);
    return window.lab07Frames;
  });
  await cdp.send("Tracing.end");
  await tracingDone;
  const { profile: cpu } = await cdp.send("Profiler.stop");
  const { profile: heap } = await cdp.send("HeapProfiler.stopSampling");
  const renderer = trace.find(e => e.name === "FireAnimationFrame" && e.ph === "X");
  const main = renderer ? trace.filter(e => e.pid === renderer.pid && e.tid === renderer.tid) : [];
  const gc = main.filter(e => /^(MinorGC|MajorGC)$/.test(e.name) && e.ph === "X").map(e => e.dur / 1000);
  const callbacks = main.filter(e => e.name === "FireAnimationFrame" && e.ph === "X" && e.dur >= 50).map(e => e.dur / 1000);
  const allocations = new Map();
  function visit(node) {
    const name = node.callFrame.functionName || "(anonymous)";
    if (node.selfSize && node.callFrame.url.includes("/assets/")) allocations.set(name, (allocations.get(name) ?? 0) + node.selfSize);
    for (const child of node.children) visit(child);
  }
  visit(heap.head);

  // Offload the real percentile calculation once the capture is complete.
  const trial = await page.evaluate(async data => {
    function summarize(samples) {
      samples.sort();
      return [.5, .95, .99].map(p => samples[Math.ceil(samples.length * p) - 1]);
    }
    const url = URL.createObjectURL(new Blob([`onmessage=e=>postMessage((${summarize})(e.data));`], { type: "text/javascript" }));
    const worker = new Worker(url);
    const local = [], dispatch = [], roundTrip = [];
    try {
      for (let i = 0; i < 20; i++) {
        const input = Float64Array.from(data), copy = input.slice();
        let t = performance.now();
        const expected = summarize(input);
        local.push(performance.now() - t);
        const done = new Promise(resolve => { worker.onmessage = e => resolve(e.data); });
        t = performance.now();
        worker.postMessage(copy, [copy.buffer]);
        dispatch.push(performance.now() - t);
        const output = await done;
        roundTrip.push(performance.now() - t);
        if (JSON.stringify(output) !== JSON.stringify(expected)) throw Error("Worker mismatch");
      }
      return { local, dispatch, roundTrip };
    } finally { worker.terminate(); URL.revokeObjectURL(url); }
  }, frames);
  if (!frames.length || !callbacks.length || !cpu.samples.length) throw new Error("Incomplete profile");
  const data = {
    chromium: browser.version(), bots: 8, seconds: 30, frames: frames.length,
    frameMs: quantiles(frames), callbackMs: quantiles(callbacks),
    gc: { count: gc.length, max: Math.max(0, ...gc), total: gc.reduce((a, b) => a + b, 0) },
    allocations: [...allocations].sort((a, b) => b[1] - a[1]).slice(0, 5),
    worker: Object.fromEntries(Object.entries(trial).map(([k, v]) => [k, q(v, .5)])),
  };
  await writeFile(prefix + ".json", JSON.stringify(data, null, 2) + "\n");
  const svg = flame(cpu);
  await writeFile(prefix + ".svg", svg);
  const capture = await browser.newPage({ viewport: { width: 1000, height: 370 } });
  await capture.setContent('<body style="margin:0">' + svg);
  await capture.screenshot({ path: prefix + ".png" });
  console.log(data);
} finally {
  await browser.close();
  await Promise.all(stops.map(stop => stop()));
}
