import { isIP } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function readConfig(env = process.env) {
  const rawPort = env.PORT ?? "3000";
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }
  const host = env.HOST ?? "127.0.0.1";
  if (!isIP(host)) throw new Error("HOST must be an IP address");
  const directory = env.LOG_DIR ?? "logs";
  if (!directory.trim() || directory.includes("\0")) throw new Error("LOG_DIR must be a valid path");
  if (env.DEMO_SLOW !== undefined && !["0", "1"].includes(env.DEMO_SLOW)) {
    throw new Error("DEMO_SLOW must be 0 or 1");
  }
  const root = fileURLToPath(new URL("..", import.meta.url));
  return {
    host, port, logDir: resolve(root, directory),
    staticDir: resolve(root, "client/dist"), demoSlow: env.DEMO_SLOW === "1",
  };
}
