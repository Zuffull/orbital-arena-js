import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["{client,server,shared}/**/*.test.mjs"],
    coverage: {
      provider: "v8",
      include: ["shared/**/*.ts"],
      reporter: ["text", "json-summary"],
      thresholds: { lines: 85, statements: 85, functions: 85 },
    },
  },
});
