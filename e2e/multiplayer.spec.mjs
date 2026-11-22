import { test, expect } from "@playwright/test";

test("another browser sees movement and receives chat", async ({ browser, playwright, browserName, baseURL }) => {
  const secondBrowser = await playwright[browserName].launch();
  try {
    const first = await browser.newPage();
    const second = await secondBrowser.newPage();
    const room = await first.request.post(baseURL + "/api/rooms", { data: { name: "Playwright test" } });
    expect(room.ok()).toBe(true);
    const { id } = await room.json();
    const errors = [];
    for (const [page, name] of [[first, "Alpha"], [second, "Beta"]]) {
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(baseURL);
      await page.locator("#load-start").click();
      await page.locator("[name=player]").fill(name);
      await page.locator("[name=room]").selectOption(id);
      await page.locator("#lobby button").click();
    }
    await expect(second.locator("#roster")).toHaveText("Alpha, Beta");
    const graph = second.locator("#netgraph");
    await expect(graph).toHaveAttribute("data-remote-x", /\d/);
    const initial = await graph.getAttribute("data-remote-x");
    await first.keyboard.down("w");
    await expect(graph).not.toHaveAttribute("data-remote-x", initial);
    await first.keyboard.up("w");
    await second.locator("[name=message]").fill("Перевірка синхронізації");
    await second.locator("#chat button").click();
    await expect(first.locator("#chat-messages li")).toHaveText("Beta: Перевірка синхронізації");
    expect(errors).toEqual([]);
  } finally {
    await secondBrowser.close();
  }
});
