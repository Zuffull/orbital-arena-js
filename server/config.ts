import { isIP } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const schema = z.object({
  PORT: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(65535)).prefault("3000"),
  HOST: z.string().refine(host => isIP(host) !== 0, "Expected an IP address").default("127.0.0.1"),
  LOG_DIR: z.string().refine(value => Boolean(value.trim()) && !value.includes("\0"), "Invalid path").default("logs"),
  DEMO_SLOW: z.enum(["0", "1"]).default("0"),
});

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const { HOST, PORT, LOG_DIR, DEMO_SLOW } = schema.parse(env);
  const root = fileURLToPath(new URL("..", import.meta.url));
  return {
    host: HOST, port: PORT, logDir: resolve(root, LOG_DIR),
    staticDir: resolve(root, "client/dist"), demoSlow: DEMO_SLOW === "1",
  };
}
