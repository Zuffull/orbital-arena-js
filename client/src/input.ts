export function createInput(target: Window) {
  const held = new Set<string>();
  const pressed = new Set<string>();
  const controls = new Set(["KeyW", "KeyA", "KeyD", "KeyR", "KeyH", "Space", "ArrowUp", "ArrowLeft", "ArrowRight"]);

  function keydown(event: KeyboardEvent) {
    if (!controls.has(event.code)) return;
    if ((event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]"))) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    if (!held.has(event.code) && !event.repeat) pressed.add(event.code);
    held.add(event.code);
  }

  function keyup(event: KeyboardEvent) {
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
    isDown: (code: string) => held.has(code),
    justPressed: (code: string) => pressed.delete(code),
    destroy() {
      target.removeEventListener("keydown", keydown);
      target.removeEventListener("keyup", keyup);
      target.removeEventListener("blur", clear);
      clear();
    },
  };
}
