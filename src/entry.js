import { loadAll, loadJson, withRetry } from "./assets.js";
import { createAudio } from "./audio.js";
import { Lobby } from "./lobby.js";
import { connectLobby } from "./lobby-view.js";
import { startLocalGame } from "./local-game.js";
import { createSpriteRenderer } from "./sprites.js";

const params = new URLSearchParams(location.search);
const game = document.querySelector("#game");

if (params.has("experiment")) {
  document.querySelector("#loading").hidden = true;
  document.querySelector("#leave").hidden = true;
  game.hidden = false;
  void import("./main.js");
} else {
  setup();
}

function setup() {
  const loading = document.querySelector("#loading");
  const lobbyPanel = document.querySelector("#lobby");
  const canvas = document.querySelector("#loading-bar");
  const ctx = canvas.getContext("2d");
  const message = loading.querySelector("[role=status]");
  const start = document.querySelector("#load-start");
  const cancel = document.querySelector("#load-cancel");
  const leave = document.querySelector("#leave");
  const lobby = new Lobby();
  const events = new EventTarget();
  const sounds = ["fired", "hit", "exploded"];
  let failure = params.get("failure");
  let controller;
  let audio;
  let resources;
  let stopGame;

  function progress(done, total) {
    const percent = total ? Math.round(100 * done / total) : 0;
    canvas.setAttribute("aria-valuenow", String(percent));
    ctx.fillStyle = "#233951";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#78dfff";
    ctx.fillRect(0, 0, canvas.width * percent / 100, canvas.height);
  }

  async function initialize() {
    if (controller) return;
    controller = new AbortController();
    const faults = failure;
    failure = null;
    start.hidden = true;
    cancel.hidden = false;
    progress(0, 0);
    message.textContent = "Завантаження маніфесту…";
    try {
      audio ??= createAudio();
      void audio.unlock().catch(() => {});
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]);
      const manifest = await withRetry(active => loadJson("/assets/manifest.json", active), signal);
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
          if (faults === "abort" && done === 1) controller.abort();
        },
      });
      document.body.dataset.loadMs = (performance.now() - begin).toFixed(1);
      audio.setBuffers(resources);
      loading.hidden = true;
      lobbyPanel.hidden = false;
      lobby.start();
    } catch (error) {
      controller.abort();
      message.textContent = `${error.name}: ${error.message}`;
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
    stopGame?.();
  }, { once: true });
  lobby.addEventListener("join", ({ detail }) => {
    void audio.unlock().catch(() => {});
    lobbyPanel.hidden = true;
    game.hidden = false;
    document.querySelector("#room-title").textContent = `${detail.room.name} · ${detail.player}`;
    stopGame = startLocalGame({
      arena: { ...resources.arena, ...detail.room.arena },
      renderEntity: createSpriteRenderer(resources.atlas),
      onEvent: event => events.dispatchEvent(new CustomEvent(event.type, { detail: event })),
    });
  });
  leave.addEventListener("click", () => {
    stopGame?.();
    stopGame = undefined;
    game.hidden = true;
    lobbyPanel.hidden = false;
    lobby.start();
  });
  progress(0, 0);
}
