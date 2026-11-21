import type { Resources } from "./assets.ts";

export type Sound = "fired" | "hit" | "exploded";

export function createAudio() {
  const context = new AudioContext();
  let buffers: Resources = {};
  return {
    context,
    async unlock() { await context.resume(); },
    setBuffers(value: Resources) { buffers = value; },
    play(name: Sound) {
      const buffer = buffers[name];
      if (!(buffer instanceof AudioBuffer) || context.state !== "running") return;
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      gain.gain.value = 0.24;
      source.connect(gain).connect(context.destination);
      source.start();
    },
  };
}
