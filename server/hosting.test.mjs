import { expect, test } from "vitest";
import { readConfig } from "./config.ts";
import { acceptOrigin, clientAddress } from "./ws.ts";

test("production requires an allowlisted origin on every upgrade", () => {
  const policy = readConfig({ NODE_ENV: "production", RENDER_EXTERNAL_URL: "https://orbital.example.org" });
  expect(acceptOrigin("https://orbital.example.org", policy)).toBe(true);
  expect(acceptOrigin("http://orbital.example.org", policy)).toBe(false);
  expect(acceptOrigin("https://orbital.example.org.evil.test", policy)).toBe(false);
  expect(acceptOrigin(undefined, policy)).toBe(false);
});

test("development permits loopback Origin and command-line sockets", () => {
  const policy = readConfig({});
  expect(acceptOrigin("http://127.0.0.1:5173", policy)).toBe(true);
  expect(acceptOrigin("http://localhost:5173", policy)).toBe(true);
  expect(acceptOrigin(undefined, policy)).toBe(true);
  expect(acceptOrigin("null", policy)).toBe(false);
});

test("an invalid origin, connection limit, or build SHA blocks startup", () => {
  expect(() => readConfig({ PUBLIC_ORIGINS: "https://orbital.example.org/path" })).toThrow();
  expect(() => readConfig({ MAX_IP_CONNECTIONS: "0" })).toThrow();
  expect(() => readConfig({ MAX_PLAYERS: "200" })).toThrow();
  expect(() => readConfig({ BUILD_SHA: "bad" })).toThrow();
  expect(readConfig({ MAX_ROOMS: "3", MAX_PLAYERS: "6" })).toMatchObject({ maxRooms: 3, maxPlayers: 6 });
});

test("forwarded address is read only when the trusted proxy mode is enabled", () => {
  const request = { headers: { "x-forwarded-for": "192.0.2.1, 192.0.2.2" }, socket: { remoteAddress: "127.0.0.1" } };
  expect(clientAddress(request, false)).toBe("127.0.0.1");
  expect(clientAddress(request, true)).toBe("192.0.2.2");
});
