import { decodeSnapshot, encodeInput } from "../../shared/codec.ts";
import { VERSION as v, serverMessage, type Input, type ServerMessage } from "../../shared/protocol.ts";

export type RoomPacket = ServerMessage | { type: "status" | "lost"; text: string };
export type Connection = ReturnType<typeof connectRoom>;

const permanent = new Set([1003, 1008, 1009]);
const encoder = new TextEncoder();

export function connectRoom(room: string, name: string, receive: (packet: RoomPacket) => void) {
  const params = new URLSearchParams(location.search);
  const binary = !params.has("json");
  const settings = new URLSearchParams();
  for (const key of ["lag", "jitter", "loss"]) {
    const value = params.get(key);
    if (value !== null) settings.set(key, value);
  }
  const queue: string[] = [];
  const probes = new Map<number, number>();
  let socket: WebSocket;
  let retryTimer: number | undefined, sendTimer: number | undefined, probeTimer: number | undefined;
  let attempts = 0, nonce = 0, bytes = 0, bps = 0, from = performance.now();
  let joined = false, stopped = false;
  let rtt: number | null = null;

  function send(payload: string | ArrayBuffer) {
    socket.send(payload);
    bytes += typeof payload === "string" ? encoder.encode(payload).byteLength : payload.byteLength;
  }

  function flush() {
    if (!joined || !queue.length || sendTimer || socket.readyState !== WebSocket.OPEN) return;
    sendTimer = window.setTimeout(() => {
      sendTimer = undefined;
      if (!joined || socket.readyState !== WebSocket.OPEN) return;
      if (socket.bufferedAmount < 16_384) {
        const message = queue.shift();
        if (message !== undefined) send(message);
      }
      flush();
    }, 150);
  }

  function probe() {
    if (!joined || socket.readyState !== WebSocket.OPEN) return;
    const oldest = probes.keys().next().value;
    if (probes.size >= 4 && oldest !== undefined) probes.delete(oldest);
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
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
    const scheme = location.protocol === "http:" && loopback ? "ws:" : "wss:";
    const connection = new WebSocket(scheme + "//" + location.host + "/ws?" + settings);
    connection.binaryType = "arraybuffer";
    socket = connection;
    receive({ type: "status", text: "РџС–РґРєР»СЋС‡РµРЅРЅСЏвЂ¦" });
    connection.addEventListener("open", () => {
      send(JSON.stringify({ v, type: "join", room, name, codec: binary ? "bin" : "json" }));
    });
    connection.addEventListener("message", (event: MessageEvent<unknown>) => {
      const { data } = event;
      if (stopped || connection !== socket) return;
      let packet: ServerMessage;
      try {
        if (typeof data === "string") {
          bytes += encoder.encode(data).byteLength;
          const parsed = serverMessage.safeParse(JSON.parse(data));
          if (!parsed.success) return;
          packet = parsed.data;
        } else if (data instanceof ArrayBuffer) {
          bytes += data.byteLength;
          packet = decodeSnapshot(data);
        } else return;
      } catch { return; }
      if (packet?.v !== v) return;
      if (packet.type === "joined") {
        joined = true;
        attempts = 0;
        probe();
        probeTimer = window.setInterval(probe, 1000);
        flush();
      }
      if (packet.type === "probe") {
        const sent = probes.get(packet.nonce);
        if (sent !== undefined) {
          rtt = performance.now() - sent;
          probes.delete(packet.nonce);
        }
      }
      receive(packet);
    });
    connection.addEventListener("close", event => {
      if (stopped || connection !== socket) return;
      disconnect();
      if (permanent.has(event.code) || event.code === 1001 || attempts >= 3) {
        stopped = true;
        queue.length = 0;
        receive({ type: "lost", text: "Р—'С”РґРЅР°РЅРЅСЏ Р·Р°РєСЂРёС‚Рѕ: " + event.reason });
        return;
      }
      const delay = Math.min(5000, 250 * 2 ** attempts++);
      receive({ type: "status", text: "РџРѕРІС‚РѕСЂРЅРµ РїС–РґРєР»СЋС‡РµРЅРЅСЏ С‡РµСЂРµР· " + delay + " РјСЃвЂ¦" });
      retryTimer = window.setTimeout(connect, delay);
    });
  }

  connect();
  return {
    sendInput(input: Input) {
      if (!joined || socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 16_384) return false;
      send(binary ? encodeInput(input) : JSON.stringify({ ...input, v }));
      return true;
    },
    send(text: string) {
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
