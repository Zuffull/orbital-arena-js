export function createInput(target) {
  const held = new Set();
  const pressed = new Set();
  const controls = new Set(["KeyW", "KeyA", "KeyD", "KeyR", "KeyH", "Space", "ArrowUp", "ArrowLeft", "ArrowRight"]);

  function keydown(event) {
    if (!controls.has(event.code)) return;
    if (event.target?.closest?.("input, textarea, select, [contenteditable]")) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    if (!held.has(event.code) && !event.repeat) pressed.add(event.code);
    held.add(event.code);
  }

  function keyup(event) {
    held.delete(event.code);
  }

  function clear() {
    held.clear();
    pressed.clear();
  }

  target.addEventListener("keydown", keydown);
  target.addEventListener("keyup", keyup);
  target.addEventListener("blur", clear);
  return {
    isDown: (code) => held.has(code),
    justPressed: (code) => pressed.delete(code),
    destroy() {
      target.removeEventListener("keydown", keydown);
      target.removeEventListener("keyup", keyup);
      target.removeEventListener("blur", clear);
      clear();
    },
  };
}
