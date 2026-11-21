export class Vector2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  add(other) { return new Vector2(this.x + other.x, this.y + other.y); }
  sub(other) { return new Vector2(this.x - other.x, this.y - other.y); }
  scale(factor) { return new Vector2(this.x * factor, this.y * factor); }
  length() { return Math.hypot(this.x, this.y); }
  normalize() { const length = this.length(); return length ? this.scale(1 / length) : new Vector2(); }
  rotate(angle) { const c = Math.cos(angle); const s = Math.sin(angle); return new Vector2(this.x * c - this.y * s, this.x * s + this.y * c); }
  dot(other) { return this.x * other.x + this.y * other.y; }
  static fromAngle(angle) { return new Vector2(Math.cos(angle), Math.sin(angle)); }
}
