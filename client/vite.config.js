import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL("..", import.meta.url)), "");
  const target = "http://127.0.0.1:" + (env.PORT || "3000");
  return { server: { proxy: { "/api": { target }, "/ws": { target, ws: true } } } };
});
