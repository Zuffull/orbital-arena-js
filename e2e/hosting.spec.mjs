import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

test("returns to lobby after unexpected process loss", async ({ page }) => {
  test.skip(process.platform === "win32", "CI uses Linux SIGKILL");
  const port = "38662";
  const base = "http://127.0.0.1:" + port;
  const server = spawn(process.execPath, ["server/index.ts"], {
    env: { ...process.env, PORT: port }, stdio: "ignore",
  });
  try {
    await expect.poll(() => fetch(base + "/ready").then(r => r.status).catch(() => 0)).toBe(200);
    await page.goto(base);
    await page.locator("#load-start").click();
    await page.locator("[name=player]").fill("Pilot");
    await page.locator("#lobby button").click();
    await expect(page.locator("#roster")).toHaveText("Pilot");
    server.kill("SIGKILL");
    await expect(page.locator("#lobby")).toBeVisible({ timeout: 12_000 });
    await expect(page.locator("#lobby-notice")).not.toBeEmpty();
  } finally {
    if (server.exitCode === null && !server.killed) server.kill("SIGTERM");
    await sleep(100);
  }
});
