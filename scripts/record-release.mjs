import { chromium } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const base = process.env.ORIGIN ?? "http://127.0.0.1:38663";
const output = "docs/lab-08-demo.mp4";
const folder = await mkdtemp(join(tmpdir(), "orbital-demo-"));
const browser = await chromium.launch();
const intro = [
  ["Orbital Arena", "Лабораторна 08 · Публікація браузерної гри", "Вхід через HTTPS. Гравці однієї кімнати працюють із одним Node-процесом.", 17],
  ["Як грати", "W / ↑ — тяга · A/D / ←/→ — поворот", "Пробіл — постріл. H — самонаведення. На телефоні є сенсорні кнопки.", 25],
];
const sections = [
  ["Авторитетний сервер", "Input → 30 кроків/с → snapshot", "Клієнт прогнозує рух свого корабля і згладжує рух суперника. Бій, зіткнення й рахунок визначає сервер.", 24],
  ["Docker і реліз", "/health · /ready · /metrics", "Тег v1.0.0 збирає образ і публікує в GHCR. У /health можна звірити SHA. SIGTERM повідомляє клієнтів і закриває сокети кодом 1001.", 25],
  ["Тести і продуктивність", "Vitest · fast-check · Playwright", "Два браузери перевіряють рух і чат. У lab-07 перевірили до 128 з’єднань у 16 кімнатах, а також зібрали Chrome-профілі до й після.", 23],
  ["Встановлення гри", "PWA · HTTPS · WSS", "Android: меню Chrome → Встановити. iPhone: меню «Поділитися» → На початковий екран. Для матчу потрібне підключення.", 22],
];
function ffmpeg(args) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
  if (result.status !== 0) throw new Error("ffmpeg failed");
}
const segments = [];
try {
  const slides = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const slide = async ([title, subtitle, body, duration]) => {
    const index = segments.length;
    const png = join(folder, index + ".png"), mp4 = join(folder, index + ".mp4");
    await slides.setContent(`<!doctype html><meta charset=utf-8><style>
      body {background:#101e34;color:#eef6ff;margin:92px;font:29px system-ui, sans-serif}
      h1 {font-size:72px;margin:90px 0 20px;color:#78dfff} h2 {font-size:38px}
      p {max-width:970px;line-height:1.5} small {color:#9eb3cc}
      </style><small>ORBITAL ARENA · ДЕМОНСТРАЦІЯ</small><h1>${title}</h1><h2>${subtitle}</h2><p>${body}</p>`);
    await slides.screenshot({ path: png });
    ffmpeg(["-loop", "1", "-i", png, "-t", String(duration), "-r", "30", "-c:v", "libx264", "-threads", "2", "-pix_fmt", "yuv420p", mp4]);
    segments.push(mp4);
  };
  for (const item of intro) await slide(item);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: folder, size: { width: 1280, height: 720 } } });
  const page = await ctx.newPage(), guest = await browser.newPage();
  const response = await page.request.post(base + "/api/rooms", { data: { name: "Lab 08 демонстрація" } });
  const room = await response.json();
  for (const [pilot, name] of [[page, "Alpha"], [guest, "Beta"]]) {
    await pilot.goto(base);
    await pilot.locator("#load-start").click();
    await pilot.locator("[name=player]").fill(name);
    await pilot.locator("[name=room]").selectOption(room.id);
    await pilot.locator("#lobby button").click();
  }
  await page.waitForFunction(() => document.querySelector("#roster")?.textContent.includes("Beta"));
  await guest.locator("[name=message]").fill("Beta: бачимо один матч!");
  await guest.locator("#chat button").click();
  for (let i = 0; i < 8; i++) {
    const key = i % 2 ? "d" : "a";
    for (const player of [page, guest]) {
      await player.keyboard.down("w");
      await player.keyboard.down(key);
      await player.keyboard.down(i % 3 ? "Space" : "h");
    }
    await sleep(6500);
    for (const player of [page, guest]) for (const code of ["w", key, "Space", "h"]) await player.keyboard.up(code);
  }
  const video = page.video();
  await ctx.close();
  const gameplay = join(folder, "gameplay.mp4");
  ffmpeg(["-i", await video.path(), "-t", "59", "-r", "30", "-c:v", "libx264", "-threads", "2", "-pix_fmt", "yuv420p", gameplay]);
  segments.push(gameplay);
  for (const item of sections) await slide(item);
  const list = join(folder, "list.txt");
  await writeFile(list, segments.map(path => `file '${path.replaceAll("\\", "/")}'`).join("\n") + "\n");
  ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", output]);
  const signature = await readFile(output);
  if (signature.length < 100_000) throw new Error("Demo too short");
} finally {
  await browser.close();
  await rm(folder, { recursive: true, force: true });
}
