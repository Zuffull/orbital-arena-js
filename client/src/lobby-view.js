export function connectLobby(lobby, panel) {
  const form = panel.querySelector("form");
  const { room, player } = form.elements;
  const status = panel.querySelector("[role=status]");
  const join = form.querySelector("button");

  lobby.addEventListener("rooms", ({ detail }) => {
    const selected = room.value;
    room.replaceChildren(...detail.map(item => new Option(item.players === undefined ? item.name : item.name + " · " + item.players + "/8", item.id)));
    if (detail.some(item => item.id === selected)) room.value = selected;
    join.disabled = !detail.length;
    status.textContent = detail.length ? "" : "Кімнат поки немає.";
  });
  lobby.addEventListener("failure", ({ detail }) => {
    status.textContent = "Не вдалося оновити кімнати. " + detail.message;
  });
  form.addEventListener("submit", event => {
    event.preventDefault();
    lobby.join(room.value, player.value);
  });
}
