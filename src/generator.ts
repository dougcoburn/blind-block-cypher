import { randomBytes as nodeRandomBytes } from "node:crypto";

import { createCipher } from "./cipher";
import { InvalidIdError, decode16, encode16 } from "./encoding";

export { InvalidIdError } from "./encoding";

/** Sequence modulus: 53 bits, so every sequence is a safe JS integer. */
export const SEQ_MOD = 2 ** 53;

/** Seconds field width: `seconds` must be in `[0, 2^33)`. */
export const SECONDS_MOD = 2 ** 33;

/** Number of distinct `generatorId` values (10 bits). */
export const GENERATOR_ID_MOD = 1024;

/** Default epoch, `2026-01-01T00:00:00Z`. */
export const DEFAULT_EPOCH_MS = Date.UTC(2026, 0, 1);

const DEFAULT_MAX_FUTURE_SKEW_SECONDS = 60;
const TWO_48 = 2 ** 48;
const TWO_15 = 2 ** 15;

export interface IdGeneratorOptions {
  /** Epoch (Date or ms timestamp) on a whole second. Default 2026-01-01Z. */
  epoch?: Date | number;
  /** Generator ID, integer 0..1023. Default 0. */
  generatorId?: number;
  /** Future skew allowed by `strictTime`, in seconds. Default 60. */
  maxFutureSkewSeconds?: number;
  /** Clock in ms. Default `Date.now`. */
  now?: () => number;
  /** Random source. Default Node `crypto.randomBytes`. */
  randomBytes?: (n: number) => Uint8Array;
  /** First sequence value, integer 0..2^53-1. Default: 53 random bits. */
  sequenceStart?: number;
  /** Default for `decode`'s `strictTime`. Default false. */
  strictTime?: boolean;
}

export interface DecodeOptions {
  /** Reject IDs more than `maxFutureSkewSeconds` past `now()`. */
  strictTime?: boolean;
}

export interface DecodedId {
  date: Date;
  generatorId: number;
  seconds: number;
  sequence: number;
}

export interface IdGenerator {
  decode(id: string, options?: DecodeOptions): DecodedId;
  decodeTime(id: string): Date;
  generate(): string;
}

/** 12-byte big-endian block -> bigint in [0, 2^96). */
function blockToBigint(block: Uint8Array): bigint {
  const b = Buffer.from(block.buffer, block.byteOffset, block.length);
  return (b.readBigUInt64BE(0) << 32n) | BigInt(b.readUInt32BE(8));
}

/** bigint in [0, 2^96) -> 12-byte big-endian block. */
function bigintToBlock(v: bigint): Buffer {
  const b = Buffer.alloc(12);
  b.writeBigUInt64BE(v >> 32n, 0);
  b.writeUInt32BE(Number(v & 0xffffffffn), 8);
  return b;
}

function isIntIn(value: unknown, min: number, maxExclusive: number): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value < maxExclusive
  );
}

function resolveEpoch(epoch: Date | number | undefined): number {
  const ms = epoch === undefined ? DEFAULT_EPOCH_MS : Number(epoch);
  if (!Number.isFinite(ms) || ms % 1000 !== 0) {
    throw new RangeError("epoch must be a valid time on a whole second");
  }

  return ms;
}

function randomStart(randomBytes: (n: number) => Uint8Array): number {
  const buf = Buffer.from(randomBytes(7));
  // 56 random bits; keep the low 53 (uniform).
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- 7 bytes read below
  const value = (buf[0]! & 0x1f) * TWO_48 + buf.readUIntBE(1, 6);
  return value;
}

/**
 * Create an id96 generator: 16-character base64url IDs that encrypt
 * `seconds:33 | generatorId:10 | sequence:53` under a fixed 20-round,
 * 96-bit Feistel keyed by `key`.
 */
export function createIdGenerator(
  key: Uint8Array | string,
  options: IdGeneratorOptions = {}
): IdGenerator {
  const cipher = createCipher(key);
  const epochMs = resolveEpoch(options.epoch);
  const now = options.now ?? Date.now;
  const randomBytes = options.randomBytes ?? nodeRandomBytes;
  const strictDefault = options.strictTime ?? false;

  const generatorId = options.generatorId ?? 0;
  if (!isIntIn(generatorId, 0, GENERATOR_ID_MOD)) {
    throw new RangeError("generatorId must be an integer in 0..1023");
  }

  const maxSkew =
    options.maxFutureSkewSeconds ?? DEFAULT_MAX_FUTURE_SKEW_SECONDS;
  if (typeof maxSkew !== "number" || !(maxSkew >= 0)) {
    throw new RangeError("maxFutureSkewSeconds must be a number >= 0");
  }

  let sequence: number;
  if (options.sequenceStart === undefined) {
    sequence = randomStart(randomBytes);
  } else {
    if (!isIntIn(options.sequenceStart, 0, SEQ_MOD)) {
      throw new RangeError("sequenceStart must be an integer in 0..2^53-1");
    }

    sequence = options.sequenceStart;
  }

  let lastSecond = -1;

  function decode(id: string, decodeOptions: DecodeOptions = {}): DecodedId {
    const block = bigintToBlock(cipher.decrypt96(blockToBigint(decode16(id))));
    const hi = block.readUIntBE(0, 6); // seconds:33 | generatorId:10 | seq top 5
    const lo = block.readUIntBE(6, 6); // seq low 48
    const seconds = Math.floor(hi / TWO_15);
    const decodedGeneratorId = Math.floor(hi / 32) % GENERATOR_ID_MOD;
    const decodedSequence = (hi % 32) * TWO_48 + lo;
    const ms = epochMs + seconds * 1000;

    if (
      (decodeOptions.strictTime ?? strictDefault) &&
      ms > now() + maxSkew * 1000
    ) {
      throw new InvalidIdError(
        "id time is more than maxFutureSkewSeconds in the future"
      );
    }

    return {
      date: new Date(ms),
      generatorId: decodedGeneratorId,
      seconds,
      sequence: decodedSequence,
    };
  }

  return {
    decode,
    decodeTime(id) {
      return decode(id).date;
    },
    generate() {
      // A clock that steps back pins to the last minted second.
      const current = Math.floor((now() - epochMs) / 1000);
      const s = Math.max(lastSecond, current);
      if (s < 0) {
        throw new RangeError("clock is before the epoch");
      }

      if (s >= SECONDS_MOD) {
        throw new RangeError("seconds past 33-bit rollover");
      }

      const block = Buffer.alloc(12);
      // hi = seconds * 2^10 + generatorId (43 bits); 48 top bits add seq's top 5.
      const hi = s * GENERATOR_ID_MOD + generatorId;
      block.writeUIntBE(hi * 32 + Math.floor(sequence / TWO_48), 0, 6);
      block.writeUIntBE(sequence % TWO_48, 6, 6);
      const id = encode16(
        bigintToBlock(cipher.encrypt96(blockToBigint(block)))
      );

      lastSecond = s;
      // Plain counter: +1 per ID, wrapping mod 2^53, never reset per second.
      sequence = (sequence + 1) % SEQ_MOD;

      return id;
    },
  };
}
