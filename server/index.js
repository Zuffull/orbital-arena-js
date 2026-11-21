import { Buffer } from "node:buffer";
import { createReadStream } from "node:fs";
import { mkdir, realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { readConfig } from "./config.js";
import { boundedText } from "./protocol.js";
import { streamReplay } from "./replay.js";
import { RoomManager } from "./rooms.js";
import { attachSockets } from "./ws.js";

const mime = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".txt": "text/plain", ".svg": "image/svg+xml",
  ".png": "image/png", ".wav": "audio/wav",
};

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify(payload));
}

async function createRoom(req, res, manager) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 2048) {
      req.resume();
      return json(res, 413, { error: "Body too large" });
    }
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { return json(res, 400, { error: "Invalid JSON" }); }
  if (!boundedText(body?.name, 32)) return json(res, 400, { error: "Invalid room name" });
  const room = manager.create(body.name.trim());
  return room ? json(res, 201, room.summary()) : json(res, 409, { error: "Room limit" });
}

async function serveStatic(root, path, req, res) {
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
  res.writeHead(200, { "Content-Type": type, "Content-Length": info.size });
  if (req.method === "HEAD") res.end();
  else await pipeline(createReadStream(canonical), res);
}

const config = readConfig();
await mkdir(config.logDir, { recursive: true });
const manager = new RoomManager(config.logDir);

async function route(req, res) {
  let path;
  try { path = decodeURIComponent(req.url.split("?")[0]); }
  catch { return json(res, 400, { error: "Invalid URL" }); }
  if (!path.startsWith("/") || path.includes("\\") || path.includes("\0") || path.split("/").includes("..")) {
    return json(res, 403, { error: "Forbidden path" });
  }
  const method = req.method;
  if (path === "/health" && method === "GET") return json(res, 200, { ok: true });
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
  void route(req, res).catch(error => {
    if (res.destroyed || ["ERR_STREAM_PREMATURE_CLOSE", "ECONNRESET"].includes(error.code)) return;
    console.error(error);
    if (res.headersSent) res.destroy();
    else json(res, 500, { error: "Internal error" });
  });
});
const sockets = attachSockets(server, manager);
server.on("error", error => {
  console.error("HTTP server:", error.message);
  process.exitCode = 1;
  sockets.close();
  void manager.close();
});
server.listen(config.port, config.host, () => console.log(`READY ${config.host}:${config.port}`));

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  const httpClosed = new Promise(resolve => server.close(resolve));
  const wsClosed = new Promise(resolve => sockets.close(resolve));
  for (const socket of sockets.clients) socket.close(1001, "Server stopping");
  const force = setTimeout(() => {
    for (const socket of sockets.clients) socket.terminate();
    server.closeAllConnections();
  }, 1500);
  await Promise.all([httpClosed, wsClosed]);
  clearTimeout(force);
  await manager.close();
  console.log("STOPPED");
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
