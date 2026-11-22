import { isIP } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const integer = (max: number) => z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(max));
const origin = z.url().transform(value => new URL(value)).refine(
  value => ["http:", "https:"].includes(value.protocol) && value.href === value.origin + "/",
  "Expected HTTP(S) origin without path, auth or query",
).transform(value => value.origin);

const schema = z.object({
  PORT: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(65535)).prefault("3000"),
  HOST: z.string().refine(host => isIP(host) !== 0, "Expected an IP address").default("127.0.0.1"),
  LOG_DIR: z.string().refine(value => Boolean(value.trim()) && !value.includes("\0"), "Invalid path").default("logs"),
  PUBLIC_ORIGINS: z.string().optional(),
  RENDER_EXTERNAL_URL: origin.optional(),
  MAX_IP_CONNECTIONS: integer(512).optional(),
  MAX_ROOMS: integer(64).prefault("16"),
  MAX_PLAYERS: integer(16).prefault("8"),
  TRUST_PROXY: z.enum(["0", "1"]).default("0"),
  BUILD_SHA: z.string().regex(/^(?:[0-9a-f]{40})?$/).optional(),
  DEMO_SLOW: z.enum(["0", "1"]).default("0"),
});

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.parse(env);
  const { HOST, PORT, LOG_DIR, DEMO_SLOW } = parsed;
  const origins = new Set(
    parsed.PUBLIC_ORIGINS?.split(",").map(value => origin.parse(value.trim())) ?? [],
  );
  if (parsed.RENDER_EXTERNAL_URL) origins.add(parsed.RENDER_EXTERNAL_URL);
  const deployed = env.NODE_ENV === "production";
  const root = fileURLToPath(new URL("..", import.meta.url));
  return {
    host: HOST, port: PORT, logDir: resolve(root, LOG_DIR),
    origins, deployed, buildSha: parsed.BUILD_SHA || "local",
    trustProxy: parsed.TRUST_PROXY === "1", maxIpConnections: parsed.MAX_IP_CONNECTIONS ?? (deployed ? 12 : 192),
    maxRooms: parsed.MAX_ROOMS, maxPlayers: parsed.MAX_PLAYERS,
    staticDir: resolve(root, "client/dist"), demoSlow: DEMO_SLOW === "1",
  };
}
