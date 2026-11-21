import type { Lobby } from "./lobby.ts";
import { requireElement } from "./dom.ts";

export function connectLobby(lobby: Lobby, panel: HTMLElement) {
  const form = requireElement("form", HTMLFormElement, panel);
  const room = requireElement("[name=room]", HTMLSelectElement, form);
  const player = requireElement("[name=player]", HTMLInputElement, form);
  const status = requireElement("[role=status]", HTMLElement, panel);
  const join = requireElement("button", HTMLButtonElement, form);

  lobby.on("rooms", (detail) => {
    const selected = room.value;
    room.replaceChildren(...detail.map(item => new Option(item.players === undefined ? item.name : item.name + " · " + item.players + "/8", item.id)));
    if (detail.some(item => item.id === selected)) room.value = selected;
    join.disabled = !detail.length;
    status.textContent = detail.length ? "" : "Кімнат поки немає.";
  });
  lobby.on("failure", (detail) => {
    status.textContent = "Не вдалося оновити кімнати. " + detail.message;
  });
  form.addEventListener("submit", event => {
    event.preventDefault();
    lobby.join(room.value, player.value);
  });
}
