import { decodeSnapshot, encodeInput } from "../../shared/codec.js";
import { VERSION as v } from "../../shared/protocol.js";

const permanent = new Set([1003, 1008, 1009]);
const encoder = new TextEncoder();

export function connectRoom(room, name, receive) {
  const params = new URLSearchParams(location.search);
  const binary = !params.has("json");
  const settings = new URLSearchParams();
  for (const key of ["lag", "jitter", "loss"]) if (params.has(key)) settings.set(key, params.get(key));
  const queue = [];
  const probes = new Map();
  let socket, retryTimer, sendTimer, probeTimer;
  let attempts = 0, nonce = 0, bytes = 0, bps = 0, from = performance.now();
  let joined = false, stopped = false, rtt = null;

  function send(payload) {
    socket.send(payload);
    bytes += typeof payload === "string" ? encoder.encode(payload).byteLength : payload.byteLength;
  }

  function flush() {
    if (!joined || !queue.length || sendTimer || socket.readyState !== WebSocket.OPEN) return;
    sendTimer = setTimeout(() => {
      sendTimer = undefined;
      if (!joined || socket.readyState !== WebSocket.OPEN) return;
      if (socket.bufferedAmount < 16_384) send(queue.shift());
      flush();
    }, 150);
  }

  function probe() {
    if (!joined || socket.readyState !== WebSocket.OPEN) return;
    if (probes.size >= 4) probes.delete(probes.keys().next().value);
    probes.set(++nonce, performance.now());
    send(JSON.stringify({ v, type: "probe", nonce }));
  }

  function disconnect() {
    joined = false;
    clearTimeout(sendTimer);
    clearInterval(probeTimer);
    sendTimer = undefined;
    probes.clear();
  }

  function connect() {
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    const connection = new WebSocket(scheme + "//" + location.host + "/ws?" + settings);
    connection.binaryType = "arraybuffer";
    socket = connection;
    receive({ type: "status", text: "Підключення…" });
    connection.addEventListener("open", () => {
      send(JSON.stringify({ v, type: "join", room, name, codec: binary ? "bin" : "json" }));
    });
    connection.addEventListener("message", ({ data }) => {
      if (stopped || connection !== socket) return;
      let packet;
      try {
        bytes += typeof data === "string" ? encoder.encode(data).byteLength : data.byteLength;
        packet = typeof data === "string" ? JSON.parse(data) : decodeSnapshot(data);
      } catch { return; }
      if (packet?.v !== v) return;
      if (packet.type === "joined") {
        joined = true;
        attempts = 0;
        probe();
        probeTimer = setInterval(probe, 1000);
        flush();
      }
      if (packet.type === "probe" && probes.has(packet.nonce)) {
        rtt = performance.now() - probes.get(packet.nonce);
        probes.delete(packet.nonce);
      }
      receive(packet);
    });
    connection.addEventListener("close", event => {
      if (stopped || connection !== socket) return;
      disconnect();
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
    sendInput(input) {
      if (!joined || socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 16_384) return false;
      send(binary ? encodeInput(input) : JSON.stringify({ ...input, v }));
      return true;
    },
    send(text) {
      if (stopped || queue.length >= 24) return false;
      queue.push(JSON.stringify({ v, type: "chat", text }));
      flush();
      return true;
    },
    metrics() {
      const now = performance.now();
      if (now - from >= 1000) {
        bps = Math.round(bytes * 1000 / (now - from));
        bytes = 0;
        from = now;
      }
      return { rtt, bps };
    },
    close() {
      stopped = true;
      disconnect();
      clearTimeout(retryTimer);
      queue.length = 0;
      socket.close(1000, "Leave");
    },
  };
}
