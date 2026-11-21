const version = 1;
const permanent = new Set([1003, 1008, 1009]);

export function connectRoom(room, name, receive) {
  const queue = [];
  let socket;
  let retryTimer;
  let sendTimer;
  let attempts = 0;
  let joined = false;
  let stopped = false;

  function flush() {
    if (!joined || !queue.length || sendTimer || socket.readyState !== WebSocket.OPEN) return;
    sendTimer = setTimeout(() => {
      sendTimer = undefined;
      if (!joined || socket.readyState !== WebSocket.OPEN) return;
      if (socket.bufferedAmount < 16_384) socket.send(queue.shift());
      flush();
    }, 150);
  }

  function connect() {
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    const connection = new WebSocket(scheme + "//" + location.host + "/ws");
    socket = connection;
    receive({ type: "status", text: "Підключення…" });

    connection.addEventListener("open", () => {
      connection.send(JSON.stringify({ v: version, type: "join", room, name }));
    });
    connection.addEventListener("message", event => {
      if (stopped || connection !== socket) return;
      let packet;
      try { packet = JSON.parse(event.data); } catch { return; }
      if (packet?.v !== version) return;
      if (packet.type === "joined") {
        joined = true;
        attempts = 0;
        flush();
      }
      receive(packet);
    });
    connection.addEventListener("close", event => {
      if (stopped || connection !== socket) return;
      joined = false;
      clearTimeout(sendTimer);
      sendTimer = undefined;
      if (permanent.has(event.code)) {
        stopped = true;
        queue.length = 0;
        receive({ type: "status", text: "З'єднання закрито: " + event.reason });
        return;
      }
      const delay = Math.min(5000, 250 * 2 ** attempts++);
      receive({ type: "status", text: "Повторне підключення через " + delay + " мс…" });
      retryTimer = setTimeout(connect, delay);
    });
  }

  connect();
  return {
    send(text) {
      if (stopped || queue.length >= 24) return false;
      queue.push(JSON.stringify({ v: version, type: "chat", text }));
      flush();
      return true;
    },
    close() {
      stopped = true;
      joined = false;
      clearTimeout(retryTimer);
      clearTimeout(sendTimer);
      queue.length = 0;
      socket.close(1000, "Leave");
    },
  };
}
