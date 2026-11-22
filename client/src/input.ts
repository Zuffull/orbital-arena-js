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

  const touch = new Map<number, string>();
  const touchControls = target.document.querySelector("#touch-controls");
  function pointerDown(event: Event) {
    if (!(event instanceof PointerEvent) || !(event.target instanceof HTMLButtonElement)) return;
    const code = event.target.dataset.control;
    if (!code || !controls.has(code)) return;
    event.preventDefault();
    event.target.setPointerCapture(event.pointerId);
    touch.set(event.pointerId, code);
    pressed.add(code);
  }
  function pointerUp(event: Event) {
    if (event instanceof PointerEvent) touch.delete(event.pointerId);
  }
  touchControls?.addEventListener("pointerdown", pointerDown);
  touchControls?.addEventListener("lostpointercapture", pointerUp);
  touchControls?.addEventListener("pointerup", pointerUp);
  touchControls?.addEventListener("pointercancel", pointerUp);

  function clear() {
    held.clear();
    touch.clear();
    pressed.clear();
  }

  target.addEventListener("keydown", keydown);
  target.addEventListener("keyup", keyup);
  target.addEventListener("blur", clear);
  return {
    isDown: (code: string) => held.has(code) || (touch.size > 0 && [...touch.values()].includes(code)),
    justPressed: (code: string) => pressed.delete(code),
    destroy() {
      touchControls?.removeEventListener("pointerdown", pointerDown);
      touchControls?.removeEventListener("lostpointercapture", pointerUp);
      touchControls?.removeEventListener("pointerup", pointerUp);
      touchControls?.removeEventListener("pointercancel", pointerUp);
      target.removeEventListener("keydown", keydown);
      target.removeEventListener("keyup", keyup);
      target.removeEventListener("blur", clear);
      clear();
    },
  };
}
