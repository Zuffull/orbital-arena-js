import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  use: { baseURL: "http://127.0.0.1:38652" },
  webServer: {
    command: "node server/index.ts",
    url: "http://127.0.0.1:38652/health",
    env: { PORT: "38652" },
  },
});
