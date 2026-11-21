import { z } from "zod";

export const VERSION = 1;
export const DT = 1 / 30;
export const KINDS = ["ship", "bullet", "asteroid", "pickup", "explosion"] as const;

const uint32 = z.number().int().min(0).max(0xffffffff);
export const entityId = uint32.min(1).brand<"EntityId">();
export const tickNumber = uint32.brand<"Tick">();
export const sequence = uint32.brand<"Seq">();
export type EntityId = z.infer<typeof entityId>;
export type Tick = z.infer<typeof tickNumber>;
export type Seq = z.infer<typeof sequence>;
export type Kind = typeof KINDS[number];

const turn = z.union([z.literal(-1), z.literal(0), z.literal(1)]);
const inputSchema = z.object({
  type: z.literal("input"),
  seq: sequence.refine(value => value > 0),
  turn,
  thrust: z.boolean(),
  fire: z.boolean(),
  homing: z.boolean(),
});
export type Input = z.infer<typeof inputSchema>;
export type Controls = Pick<Input, "turn" | "thrust" | "fire"> & Partial<Pick<Input, "seq" | "homing">>;
export const ZERO_SEQ = sequence.parse(0);
export const IDLE = Object.freeze({ seq: ZERO_SEQ, turn: 0, thrust: false, fire: false, homing: false } as const);
export const isUint32 = (value: unknown): value is number => uint32.safeParse(value).success;

export function readInput(value: unknown): Input | null {
  const result = inputSchema.safeParse(value);
  return result.success ? result.data : null;
}

export const boundedString = (max: number) => z.string().trim().min(1).max(max);
const v = z.literal(VERSION);
const clientMessageSchema = z.discriminatedUnion("type", [
  inputSchema.extend({ v }),
  z.object({ v, type: z.literal("join"), room: z.string().regex(/^[a-f0-9-]{36}$/), name: boundedString(24),
    codec: z.enum(["bin", "json"]).optional() }),
  z.object({ v, type: z.literal("chat"), text: boundedString(240) }),
  z.object({ v, type: z.literal("probe"), nonce: uint32 }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export function parseClientMessage(value: unknown): ClientMessage | null {
  const result = clientMessageSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function unreachable(value: never): never {
  throw new Error(`Unhandled variant: ${String(value)}`);
}

const commonEntity = z.object({
  id: entityId, self: z.boolean(), thrust: z.boolean(), shield: z.boolean(), homing: z.boolean(),
  x: z.number(), y: z.number(), vx: z.number(), vy: z.number(), angle: z.number().min(0).max(2 * Math.PI),
  radius: z.number().int().min(0).max(255), hp: z.number().int().min(0).max(255),
  cooldown: z.number().min(0).max(65.535), shotSeq: sequence,
});
export const snapshotEntity = z.discriminatedUnion("kind", [
  commonEntity.extend({ kind: z.literal("ship") }),
  commonEntity.extend({ kind: z.literal("bullet") }),
  commonEntity.extend({ kind: z.literal("asteroid") }),
  commonEntity.extend({ kind: z.literal("pickup") }),
  commonEntity.extend({ kind: z.literal("explosion") }),
]);
export type SnapshotEntity = z.infer<typeof snapshotEntity>;
export const snapshotSchema = z.object({
  v, type: z.literal("snapshot"), tick: tickNumber, ack: sequence, score: uint32,
  entities: z.array(snapshotEntity).max(1024),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

const player = z.object({ id: z.string(), name: boundedString(24) });
export const serverMessage = z.discriminatedUnion("type", [
  snapshotSchema,
  z.object({ v, type: z.literal("joined"), id: z.string(), replayId: z.string(), seed: uint32 }),
  z.object({ v, type: z.literal("roster"), players: z.array(player) }),
  player.extend({ v, type: z.literal("chat"), text: boundedString(240) }),
  z.object({ v, type: z.literal("notice"), text: z.string() }),
  z.object({ v, type: z.literal("probe"), nonce: uint32 }),
]);
export type ServerMessage = z.infer<typeof serverMessage>;
