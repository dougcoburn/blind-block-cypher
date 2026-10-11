import { randomBytes as nodeRandomBytes } from "node:crypto";

/** Fields of a 96-bit plain ID: `seconds:33 | generatorId:10 | sequence:53`. */
export interface PlainIdFields {
  /** Integer in `[0, 1023]`. */
  generatorId: number;
  /** Whole seconds since the generator's epoch, integer in `[0, 2^33)`. */
  seconds: number;
  /** Integer in `[0, 2^53)`. */
  sequence: number;
}

export interface PlainIdGeneratorOptions {
  /** Epoch (Date or ms timestamp) on a whole second. Default 2026-01-01Z. */
  epoch?: Date | number;
  /** Generator ID, integer 0..1023. Default 0. */
  generatorId?: number;
  /** Clock in ms. Default `Date.now`. */
  now?: () => number;
  /** Random source for the default `sequenceStart`. Default Node `crypto.randomBytes`. */
  randomBytes?: (n: number) => Uint8Array;
  /** First sequence value, integer 0..2^53-1. Default: 53 random bits. */
  sequenceStart?: number;
}

export interface PlainIdGenerator {
  /** The resolved epoch in ms (whole second). */
  readonly epochMs: number;
  /** The configured generator ID. */
  readonly generatorId: number;
  /** Mint the next plain 96-bit ID (see {@link packId}). */
  next(): bigint;
}

/** Sequence modulus: 53 bits, so every sequence is a safe JS integer. */
export const SEQUENCE_MOD = 2 ** 53;
/** Seconds field width: `seconds` must be in `[0, 2^33)`. */
export const SECONDS_MOD = 2 ** 33;
/** Number of distinct `generatorId` values (10 bits). */
export const GENERATOR_ID_MOD = 1024;
/** Default epoch, `2026-01-01T00:00:00Z`. */
export const DEFAULT_EPOCH_MS = Date.UTC(2026, 0, 1);

const B_SECONDS_SHIFT = BigInt(63);
const B_GENERATOR_SHIFT = BigInt(53);
const B_GENERATOR_MASK = BigInt(GENERATOR_ID_MOD - 1);
const B_SEQUENCE_MASK = BigInt(SEQUENCE_MOD) - BigInt(1);
const B_ZERO = BigInt(0);
const B_96 = BigInt(96);
const TWO_8 = 256;

function isIntIn(value: unknown, min: number, maxExclusive: number): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value < maxExclusive
  );
}

function checkGeneratorId(value: unknown): number {
  if (!isIntIn(value, 0, GENERATOR_ID_MOD)) {
    throw new RangeError("generatorId must be an integer in 0..1023");
  }

  return value as number;
}

function pack(seconds: number, generatorId: number, sequence: number): bigint {
  return (
    (BigInt(seconds) << B_SECONDS_SHIFT) |
    (BigInt(generatorId) << B_GENERATOR_SHIFT) |
    BigInt(sequence)
  );
}

/**
 * Pack fields into a 96-bit `bigint`, seconds in the high bits. Any field out
 * of range throws `RangeError`.
 */
export function packId(fields: PlainIdFields): bigint {
  const { generatorId, seconds, sequence } = fields;
  if (!isIntIn(seconds, 0, SECONDS_MOD)) {
    throw new RangeError("seconds must be an integer in [0, 2^33)");
  }

  checkGeneratorId(generatorId);
  if (!isIntIn(sequence, 0, SEQUENCE_MOD)) {
    throw new RangeError("sequence must be an integer in [0, 2^53)");
  }

  return pack(seconds, generatorId, sequence);
}

/** Split a 96-bit `bigint` into its fields. Not a bigint in `[0, 2^96)` throws `RangeError`. */
export function unpackId(id: bigint): PlainIdFields {
  if (typeof id !== "bigint" || id < B_ZERO || id >> B_96 !== B_ZERO) {
    throw new RangeError("id must be a bigint in [0, 2^96)");
  }

  return {
    generatorId: Number((id >> B_GENERATOR_SHIFT) & B_GENERATOR_MASK),
    seconds: Number(id >> B_SECONDS_SHIFT),
    sequence: Number(id & B_SEQUENCE_MASK),
  };
}

function resolveEpoch(epoch: Date | number | undefined): number {
  const ms = epoch === undefined ? DEFAULT_EPOCH_MS : Number(epoch);
  if (!Number.isFinite(ms) || ms % 1000 !== 0) {
    throw new RangeError("epoch must be a valid time on a whole second");
  }

  return ms;
}

function randomStart(randomBytes: (n: number) => Uint8Array): number {
  const bytes = randomBytes(7);
  if (bytes.length < 7) {
    throw new RangeError("randomBytes(7) must return at least 7 bytes");
  }

  // 56 random bits; keep the low 53 (uniform, exact in a double).
  let value = 0;
  bytes.subarray(0, 7).forEach((byte, i) => {
    value = value * TWO_8 + (i === 0 ? byte & 0x1f : byte);
  });

  return value;
}

/**
 * Create a generator of plain 96-bit IDs,
 * `seconds:33 | generatorId:10 | sequence:53`. The sequence starts at a random
 * 53-bit value (or `sequenceStart`), adds 1 per ID, never resets, and wraps
 * mod 2^53. A clock that steps back pins `seconds` to the last minted second.
 */
export function createPlainIdGenerator(
  options: PlainIdGeneratorOptions = {}
): PlainIdGenerator {
  const epochMs = resolveEpoch(options.epoch);
  const now = options.now ?? Date.now;
  const generatorId = checkGeneratorId(options.generatorId ?? 0);

  let sequence: number;
  if (options.sequenceStart === undefined) {
    sequence = randomStart(options.randomBytes ?? nodeRandomBytes);
  } else {
    if (!isIntIn(options.sequenceStart, 0, SEQUENCE_MOD)) {
      throw new RangeError("sequenceStart must be an integer in 0..2^53-1");
    }

    sequence = options.sequenceStart;
  }

  let lastSecond = -1;

  return {
    epochMs,
    generatorId,
    next() {
      const s = Math.max(lastSecond, Math.floor((now() - epochMs) / 1000));
      if (!(s >= 0)) {
        throw new RangeError("clock is before the epoch");
      }

      if (s >= SECONDS_MOD) {
        throw new RangeError("seconds past 33-bit rollover");
      }

      const id = pack(s, generatorId, sequence);
      lastSecond = s;
      sequence = sequence + 1 === SEQUENCE_MOD ? 0 : sequence + 1;
      return id;
    },
  };
}
