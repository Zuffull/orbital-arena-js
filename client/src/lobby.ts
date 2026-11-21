import { fetchJson, withRetry } from "./assets.ts";

import { z } from "zod";

const roomsSchema = z.array(z.object({
  id: z.string(), name: z.string(), players: z.number().optional(),
}));
export type RoomSummary = z.infer<typeof roomsSchema>[number];
type LobbyEvents = {
  rooms: RoomSummary[];
  join: { room: RoomSummary; player: string };
  failure: Error;
};

export class Lobby extends EventTarget {
  #controller?: AbortController;
  #poll?: number;
  #pending?: AbortController;
  rooms: RoomSummary[] = [];

  on<K extends keyof LobbyEvents>(type: K, listener: (detail: LobbyEvents[K]) => void) {
    this.addEventListener(type, event => {
      // Lobby emits these names only with the matching detail via publish().
      if (event instanceof CustomEvent) listener((event as CustomEvent<LobbyEvents[K]>).detail);
    });
  }

  private publish<K extends keyof LobbyEvents>(type: K, detail: LobbyEvents[K]) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  start() {
    if (this.#controller) return;
    this.#controller = new AbortController();
    void this.refresh();
    this.#poll = window.setInterval(() => void this.refresh(), 5000);
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
      const rooms = roomsSchema.parse(await withRetry(active => fetchJson("/api/rooms", active), requestSignal));
      if (signal.aborted) return;
      this.rooms = rooms;
      this.publish("rooms", rooms);
    } catch (error) {
      if (!signal.aborted) this.publish("failure", error instanceof Error ? error : new Error(String(error)));
    } finally {
      if (this.#pending === controller) this.#pending = undefined;
    }
  }

  join(id: string, name: string) {
    if (!this.#controller) return;
    const room = this.rooms.find(item => item.id === id);
    const player = name.trim();
    if (!room || !player) return;
    this.stop();
    this.publish("join", { room, player });
  }
}
