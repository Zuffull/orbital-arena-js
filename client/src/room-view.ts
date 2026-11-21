import { connectRoom, type Connection, type RoomPacket } from "./network.ts";

import { requireElement } from "./dom.ts";
import type { RoomSummary } from "./lobby.ts";

export function connectRoomView(panel: HTMLElement) {
  const roster = requireElement("#roster", HTMLElement, panel);
  const messages = requireElement("#chat-messages", HTMLElement, panel);
  const state = requireElement("#room-state", HTMLElement, panel);
  const replay = requireElement("#replay", HTMLAnchorElement, panel);
  const form = requireElement("#chat", HTMLFormElement, panel);
  let connection: Connection | undefined;

  function leave() {
    connection?.close();
    connection = undefined;
  }

  function enter(room: RoomSummary, player: string, onPacket: (packet: RoomPacket) => void) {
    leave();
    roster.textContent = "—";
    messages.replaceChildren();
    replay.hidden = true;
    replay.removeAttribute("href");
    connection = connectRoom(room.id, player, msg => {
      onPacket(msg);
      if (msg.type === "status" || msg.type === "notice") state.textContent = msg.text;
      if (msg.type === "joined") {
        state.textContent = "Підключено";
        replay.href = "/api/replays/" + encodeURIComponent(msg.replayId);
        replay.hidden = false;
      }
      if (msg.type === "roster") roster.textContent = msg.players.map(item => item.name).join(", ") || "—";
      if (msg.type === "chat") {
        const line = document.createElement("li");
        line.textContent = msg.name + ": " + msg.text;
        messages.append(line);
        if (messages.children.length > 50) messages.firstElementChild?.remove();
        messages.scrollTop = messages.scrollHeight;
      }
    });
    return connection;
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    const field = requireElement("[name=message]", HTMLInputElement, form);
    const text = field.value.trim();
    if (!text) return;
    if (connection?.send(text)) field.value = "";
    else state.textContent = "Черга недоступна або заповнена.";
  });
  return { enter, leave };
}
