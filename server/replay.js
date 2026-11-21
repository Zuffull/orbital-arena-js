import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";

export async function* readReplay(path) {
  const input = createReadStream(path);
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) if (line.trim()) yield JSON.parse(line);
  } finally {
    lines.close();
    input.destroy();
  }
}

export async function streamReplay(logDir, id, response) {
  if (!/^[a-zA-Z0-9-]{1,96}$/.test(id)) return false;
  let file;
  try { file = await open(join(logDir, id + ".ndjson"), "r"); }
  catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
  const stat = await file.stat().catch(async error => {
    await file.close();
    throw error;
  });
  if (!stat.isFile()) {
    await file.close();
    return false;
  }
  response.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Content-Disposition": `attachment; filename="${id}.ndjson"`,
    "Content-Length": stat.size,
  });
  if (!stat.size) {
    await file.close();
    response.end();
    return true;
  }
  await pipeline(file.createReadStream({ end: stat.size - 1 }), response);
  return true;
}
