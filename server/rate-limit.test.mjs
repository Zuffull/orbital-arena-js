import { afterEach, expect, test, vi } from "vitest";
import { tokenBucket, parseClient, rawBuffer } from "./protocol.ts";
import { readConfig } from "./config.ts";

afterEach(() => vi.restoreAllMocks());
test.each([1, 2, 3, 10, 32])("allows a burst of %i then blocks", capacity => {
  vi.spyOn(performance, "now").mockReturnValue(0);
  const take = tokenBucket(capacity, 2);
  for (let i = 0; i < capacity; i++) expect(take()).toBe(true);
  expect(take()).toBe(false);
});
test("restores tokens at the configured rate and caps the burst", () => {
  const time = vi.spyOn(performance, "now").mockReturnValue(0);
  const take = tokenBucket(1, 4);
  expect(take()).toBe(true);
  time.mockReturnValue(249);
  expect(take()).toBe(false);
  time.mockReturnValue(250);
  expect(take()).toBe(true);
  time.mockReturnValue(10_000);
  expect(take()).toBe(true);
  expect(take()).toBe(false);
});
test.each(["{", "null", '{"type":"probe","v":9,"nonce":1}', '{"type":"chat","v":1,"text":" "}'])("rejects JSON %s", text => {
  expect(parseClient(Buffer.from(text))).toBeNull();
});
test("accepts fragmented WebSocket JSON and an ArrayBuffer", () => {
  expect(parseClient([Buffer.from('{"v":1,"type":"'), Buffer.from('probe","nonce":9}')])).toEqual({ v: 1, type: "probe", nonce: 9 });
  expect(rawBuffer(new Uint8Array([1, 2]).buffer)).toEqual(Buffer.from([1, 2]));
});
test("validates application configuration at startup", () => {
  expect(readConfig({ PORT: "4000", HOST: "127.0.0.1", DEMO_SLOW: "1" })).toMatchObject({ port: 4000, demoSlow: true });
  expect(() => readConfig({ PORT: "-1" })).toThrow();
});
