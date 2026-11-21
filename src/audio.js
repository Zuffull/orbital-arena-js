export function createAudio() {
  const context = new AudioContext();
  let buffers = {};
  return {
    context,
    async unlock() { await context.resume(); },
    setBuffers(value) { buffers = value; },
    play(name) {
      const buffer = buffers[name];
      if (!buffer || context.state !== "running") return;
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      gain.gain.value = 0.24;
      source.connect(gain).connect(context.destination);
      source.start();
    },
  };
}
