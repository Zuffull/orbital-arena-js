export function requireElement<T extends Element>(selector: string, type: { new(): T }, parent: ParentNode = document): T {
  const element = parent.querySelector(selector);
  if (!(element instanceof type)) throw new Error(`Missing or invalid element: ${selector}`);
  return element;
}

export function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D unavailable");
  return ctx;
}
