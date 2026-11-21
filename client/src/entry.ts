import { loadAll, loadJson, manifestSchema, withRetry, type Resources } from "./assets.ts";
import { createAudio, type Sound } from "./audio.ts";
import { Lobby } from "./lobby.ts";
import { connectLobby } from "./lobby-view.ts";
import { startOnline } from "./online-game.ts";
import { connectRoomView } from "./room-view.ts";
import { createSpriteRenderer } from "./sprites.ts";

import { context2d, requireElement } from "./dom.ts";

const params = new URLSearchParams(location.search);
const game = requireElement("#game", HTMLElement);

if (params.has("experiment")) {
  requireElement("#loading", HTMLElement).hidden = true;
  requireElement("#leave", HTMLElement).hidden = true;
  requireElement("#room-panel", HTMLElement).hidden = true;
  requireElement("#network-panel", HTMLElement).hidden = true;
  game.hidden = false;
  requireElement("#reset", HTMLElement).hidden = false;
  void import("./main.ts");
} else {
  setup();
}

function setup() {
  const loading = requireElement("#loading", HTMLElement);
  const lobbyPanel = requireElement("#lobby", HTMLElement);
  const canvas = requireElement("#loading-bar", HTMLCanvasElement);
  const ctx = context2d(canvas);
  const message = requireElement("[role=status]", HTMLElement, loading);
  const start = requireElement("#load-start", HTMLElement);
  const cancel = requireElement("#load-cancel", HTMLElement);
  const leave = requireElement("#leave", HTMLElement);
  const lobby = new Lobby();
  const chat = connectRoomView(game);
  const events = new EventTarget();
  const sounds: Sound[] = ["fired", "hit", "exploded"];
  let failure = params.get("failure");
  let controller: AbortController | undefined;
  let audio: ReturnType<typeof createAudio> | undefined;
  let resources: Resources | undefined;
  let stopGame: (() => void) | undefined;

  function progress(done: number, total: number) {
    const percent = total ? Math.round(100 * done / total) : 0;
    canvas.setAttribute("aria-valuenow", String(percent));
    ctx.fillStyle = "#233951";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#78dfff";
    ctx.fillRect(0, 0, canvas.width * percent / 100, canvas.height);
  }

  async function initialize() {
    if (controller) return;
    const request = new AbortController();
    controller = request;
    const faults = failure;
    failure = null;
    start.hidden = true;
    cancel.hidden = false;
    progress(0, 0);
    message.textContent = "Завантаження маніфесту…";
    try {
      audio ??= createAudio();
      void audio.unlock().catch(() => {});
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(8000)]);
      const manifest = manifestSchema.parse(await withRetry(active => loadJson("/assets/manifest.json", active), signal));
      const assets = manifest.map(entry => {
        if (faults === "404" && entry.type === "image") return { ...entry, url: "/assets/missing-atlas.txt" };
        if (faults === "json" && entry.type === "json") return { ...entry, url: "/assets/broken-json.txt" };
        return entry;
      });
      const assetSignal = faults === "timeout" ? AbortSignal.any([signal, AbortSignal.timeout(0)]) : signal;
      const begin = performance.now();
      resources = await loadAll(assets, {
        audio: audio.context, signal: assetSignal,
        sequential: params.has("sequential"),
        onProgress(done, total, id) {
          progress(done, total);
          message.textContent = `Завантажено ${done} з ${total} · ${id}`;
          if (faults === "abort" && done === 1) request.abort();
        },
      });
      document.body.dataset.loadMs = (performance.now() - begin).toFixed(1);
      audio.setBuffers(resources);
      loading.hidden = true;
      lobbyPanel.hidden = false;
      lobby.start();
    } catch (error) {
      request.abort();
      message.textContent = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      start.textContent = "Повторити / Retry";
      start.hidden = false;
    } finally {
      cancel.hidden = true;
      controller = undefined;
    }
  }

  for (const name of sounds) events.addEventListener(name, () => audio?.play(name));
  connectLobby(lobby, lobbyPanel);
  start.addEventListener("click", () => void initialize());
  cancel.addEventListener("click", () => controller?.abort());
  window.addEventListener("pagehide", () => {
    controller?.abort();
    lobby.stop();
    chat.leave();
    stopGame?.();
  }, { once: true });
  lobby.on("join", detail => {
    const atlas = resources?.atlas;
    if (!audio || !(atlas instanceof ImageBitmap)) return;
    void audio.unlock().catch(() => {});
    lobbyPanel.hidden = true;
    game.hidden = false;
    requireElement("#room-title", HTMLElement).textContent = `${detail.room.name} · ${detail.player}`;
    let online: ReturnType<typeof startOnline> | undefined;
    const connection = chat.enter(detail.room, detail.player, packet => online?.receive(packet));
    online = startOnline(connection, createSpriteRenderer(atlas),
      name => events.dispatchEvent(new CustomEvent(name)));
    stopGame = online.stop;
  });
  leave.addEventListener("click", () => {
    chat.leave();
    stopGame?.();
    stopGame = undefined;
    game.hidden = true;
    lobbyPanel.hidden = false;
    lobby.start();
  });
  progress(0, 0);
}
