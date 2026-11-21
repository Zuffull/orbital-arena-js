import { connectRoom } from "./network.js";

export function connectRoomView(panel) {
  const roster = panel.querySelector("#roster");
  const messages = panel.querySelector("#chat-messages");
  const state = panel.querySelector("#room-state");
  const replay = panel.querySelector("#replay");
  const form = panel.querySelector("#chat");
  let connection;

  function leave() {
    connection?.close();
    connection = undefined;
  }

  function enter(room, player, onPacket) {
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
        if (messages.children.length > 50) messages.firstElementChild.remove();
        messages.scrollTop = messages.scrollHeight;
      }
    });
    return connection;
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    const field = form.elements.message;
    const text = field.value.trim();
    if (!text) return;
    if (connection?.send(text)) field.value = "";
    else state.textContent = "Черга недоступна або заповнена.";
  });
  return { enter, leave };
}
