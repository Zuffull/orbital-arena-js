import { fetchJson, withRetry } from "./assets.js";

export class Lobby extends EventTarget {
  #controller;
  #poll;
  #pending;
  rooms = [];

  start() {
    if (this.#controller) return;
    this.#controller = new AbortController();
    void this.refresh();
    this.#poll = setInterval(() => void this.refresh(), 5000);
  }

  stop() {
    clearInterval(this.#poll);
    this.#controller?.abort();
    this.#controller = undefined;
    this.#pending = undefined;
  }

  async refresh() {
    const controller = this.#controller;
    if (!controller || this.#pending === controller) return;
    this.#pending = controller;
    const signal = controller.signal;
    try {
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(2500)]);
      const rooms = await withRetry(active => fetchJson("/api/rooms", active), requestSignal);
      if (!Array.isArray(rooms)) throw new Error("Неправильний список кімнат");
      if (signal.aborted) return;
      this.rooms = rooms;
      this.dispatchEvent(new CustomEvent("rooms", { detail: rooms }));
    } catch (error) {
      if (!signal.aborted) this.dispatchEvent(new CustomEvent("failure", { detail: error }));
    } finally {
      if (this.#pending === controller) this.#pending = undefined;
    }
  }

  join(id, name) {
    if (!this.#controller) return;
    const room = this.rooms.find(item => item.id === id);
    const player = name.trim();
    if (!room || !player) return;
    this.stop();
    this.dispatchEvent(new CustomEvent("join", { detail: { room, player } }));
  }
}
