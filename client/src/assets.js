class HttpError extends Error {
  constructor(response) {
    super(`HTTP ${response.status} · ${new URL(response.url).pathname}`);
    this.status = response.status;
  }
}

async function request(url, signal, accept) {
  const response = await fetch(url, { signal, headers: { Accept: accept } });
  if (!response.ok) throw new HttpError(response);
  return response;
}

export async function fetchJson(url, signal) {
  return (await request(url, signal, "application/json")).json();
}

export const loadJson = fetchJson;

async function loadBytes(url, signal) {
  const text = await (await request(url, signal, "text/plain")).text();
  return Uint8Array.from(atob(text.trim()), character => character.charCodeAt(0));
}

export async function loadImage(url, signal) {
  const bytes = await loadBytes(url, signal);
  const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
  if (signal.aborted) {
    bitmap.close();
    signal.throwIfAborted();
  }
  return bitmap;
}

export async function loadAudio(ctx, url, signal) {
  const bytes = await loadBytes(url, signal);
  const sound = await ctx.decodeAudioData(bytes.buffer);
  signal.throwIfAborted();
  return sound;
}

function sleep(ms, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    function abort() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function withRetry(task, signal, attempts = 3) {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      return await task(signal);
    } catch (error) {
      const transient = error instanceof TypeError || error.status >= 500;
      if (!transient || signal.aborted || attempt + 1 >= attempts) throw error;
      await sleep(150 * 2 ** attempt * (0.75 + Math.random() * 0.5), signal);
    }
  }
}

export async function loadAll(manifest, { audio, signal, onProgress, sequential = false }) {
  let finished = 0;
  async function load({ id, type, url }) {
    const value = await withRetry(current => {
      if (type === "image") return loadImage(url, current);
      if (type === "audio") return loadAudio(audio, url, current);
      return loadJson(url, current);
    }, signal);
    signal.throwIfAborted();
    onProgress(++finished, manifest.length, id);
    signal.throwIfAborted();
    return [id, value];
  }
  if (!sequential) return Object.fromEntries(await Promise.all(manifest.map(load)));
  const entries = [];
  for (const item of manifest) entries.push(await load(item));
  return Object.fromEntries(entries);
}
