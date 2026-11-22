import { Buffer } from "node:buffer";
import { createReadStream } from "node:fs";
import { mkdir, realpath, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { matches } from "./match.ts";
import { readConfig } from "./config.ts";
import { z } from "zod";
import { boundedString } from "../shared/protocol.ts";
import { streamReplay } from "./replay.ts";
import { RoomManager } from "./rooms.ts";
import { log } from "./log.ts";
import { metrics, startMetrics } from "./metrics.ts";
import { attachSockets, send } from "./ws.ts";

const roomBody = z.object({ name: boundedString(32) });

const mime: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".txt": "text/plain", ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png", ".wav": "audio/wav",
};

function json(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify(payload));
}

async function createRoom(req: IncomingMessage, res: ServerResponse, manager: RoomManager) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    if (!Buffer.isBuffer(chunk)) return json(res, 400, { error: "Invalid body" });
    size += chunk.length;
    if (size > 2048) {
      req.resume();
      return json(res, 413, { error: "Body too large" });
    }
    chunks.push(chunk);
  }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { return json(res, 400, { error: "Invalid JSON" }); }
  const result = roomBody.safeParse(body);
  if (!result.success) return json(res, 400, { error: "Invalid room name" });
  const room = manager.create(result.data.name);
  return room ? json(res, 201, room.summary()) : json(res, 409, { error: "Room limit" });
}

async function serveStatic(root: string, path: string, req: IncomingMessage, res: ServerResponse) {
  const canonicalRoot = await realpath(root).catch(() => null);
  if (!canonicalRoot) return json(res, 404, { error: "Client build missing" });
  const target = resolve(canonicalRoot, "." + (path === "/" ? "/index.html" : path));
  const canonical = await realpath(target).catch(() => null);
  if (!canonical) return json(res, 404, { error: "Not found" });
  if (!canonical.startsWith(canonicalRoot + sep)) return json(res, 403, { error: "Forbidden path" });
  const info = await stat(canonical);
  if (!info.isFile()) return json(res, 404, { error: "Not found" });
  const contentType = mime[extname(canonical)] || "application/octet-stream";
  const type = /^(text\/|application\/json)/.test(contentType) ? contentType + "; charset=utf-8" : contentType;
  res.writeHead(200, { "Content-Type": type, "Content-Length": info.size,
    "Cache-Control": path === "/sw.js" || path === "/" ? "no-cache" : "public, max-age=300",
    "X-Content-Type-Options": "nosniff",
  });
  if (req.method === "HEAD") res.end();
  else await pipeline(createReadStream(canonical), res);
}

const config = readConfig();
await mkdir(config.logDir, { recursive: true });
const manager = new RoomManager(config.logDir, config.maxRooms, config.maxPlayers);
let ready = false;
let stopping = false;
const monitor = startMetrics();

async function route(req: IncomingMessage, res: ServerResponse) {
  let path;
  try { path = decodeURIComponent(req.url?.split("?")[0] ?? ""); }
  catch { return json(res, 400, { error: "Invalid URL" }); }
  if (!path.startsWith("/") || path.includes("\\") || path.includes("\0") || path.split("/").includes("..")) {
    return json(res, 403, { error: "Forbidden path" });
  }
  const method = req.method;
  if (path === "/health" && method === "GET") return json(res, 200, { ok: true, sha: config.buildSha });
  if (path === "/ready" && method === "GET") return json(res, ready ? 200 : 503, { ready });
  if (path === "/metrics" && method === "GET") {
    res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" }).end(metrics(manager));
    return;
  }
  if (!ready) return json(res, 503, { error: "Server not ready" });
  if (path === "/api/stats" && method === "GET") return json(res, 200, [...matches.values()].map(match => match.stats()));
  if (path === "/api/rooms" && method === "GET") return json(res, 200, manager.list());
  if (path === "/api/rooms" && method === "POST") return createRoom(req, res, manager);
  if (config.demoSlow && path === "/api/slow" && method === "GET") {
    const end = performance.now() + 300;
    while (performance.now() < end) { /* Deliberate event-loop experiment. */ }
    return json(res, 200, { blockedMs: 300 });
  }
  if (path.startsWith("/api/replays/") && method === "GET") {
    if (await streamReplay(config.logDir, path.slice("/api/replays/".length), res)) return;
    return json(res, 404, { error: "Replay not found" });
  }
  if (method !== "GET" && method !== "HEAD") return json(res, 405, { error: "Method not allowed" });
  await serveStatic(config.staticDir, path, req, res);
}

const server = createServer((req, res) => {
  void route(req, res).catch((error: unknown) => {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (res.destroyed || code === "ERR_STREAM_PREMATURE_CLOSE" || code === "ECONNRESET") return;
    log.error({ err: error }, "HTTP request failed");
    if (res.headersSent) res.destroy();
    else json(res, 500, { error: "Internal error" });
  });
});
const sockets = attachSockets(server, manager, config, () => ready);
server.on("error", error => {
  log.fatal({ err: error }, "HTTP server failed");
  process.exit(1);
});
server.listen(config.port, config.host, () => {
  ready = true;
  log.info({ host: config.host, port: config.port, sha: config.buildSha }, "READY");
});
async function shutdown() {
  if (stopping) return;
  stopping = true;
  ready = false;
  clearInterval(monitor);
  log.info("Draining connections");
  for (const socket of sockets.clients) {
    send(socket, { type: "shutdown", text: "Сервер завершує роботу. Повернення в лобі." });
    socket.close(1001, "Server stopping");
  }
  const hard = setTimeout(() => {
    log.fatal("Shutdown deadline exceeded");
    process.exit(1);
  }, 8500).unref();
  const force = setTimeout(() => {
    for (const socket of sockets.clients) socket.terminate();
    server.closeAllConnections();
  }, 1500).unref();
  const wsClosed = new Promise<void>(resolve => sockets.close(() => resolve()));
  // Keep health available briefly while readiness and new upgrades are already rejected.
  const httpClosed = new Promise<void>(resolve => {
    setTimeout(() => server.close(() => resolve()), 500);
  });
  await Promise.all([httpClosed, wsClosed]);
  await manager.close();
  clearTimeout(force);
  clearTimeout(hard);
  log.info("STOPPED");
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
