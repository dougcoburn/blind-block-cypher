import { createHmac, hkdfSync } from "node:crypto";

/** Per-round key material for half widths up to 48 bits (Number path). */
export interface RoundKey {
  /** Additive constant for `mulmix`, in `[0, 2^halfBits)`. */
  a: number;
  /** HMAC-SHA256 key for the round function. */
  hmacKey: Uint8Array;
  /** Odd multiplier for `mulmix`, in `[0, 2^halfBits)`. */
  m: number;
}

/** Per-round key material for 64-bit halves (BigInt path). */
export interface RoundKey64 {
  a: bigint;
  hmacKey: Uint8Array;
  m: bigint;
}

const HMAC_KEY_BYTES = 32;
const TWO_24 = 2 ** 24;
const TWO_32 = 2 ** 32;
const TWO_48 = 2 ** 48;
const MASK64 = (1n << 64n) - 1n;

export function assertHalfBits(halfBits: number): void {
  if (
    !Number.isInteger(halfBits) ||
    halfBits < 8 ||
    halfBits > 48 ||
    halfBits % 8 !== 0
  ) {
    throw new RangeError("halfBits must be one of 8, 16, 24, 32, 40, 48");
  }
}

export function keyBytes(key: Uint8Array | string): Buffer {
  const ikm =
    typeof key === "string" ? Buffer.from(key, "utf8") : Buffer.from(key);
  if (ikm.length === 0) {
    throw new Error("key must be non-empty");
  }

  return ikm;
}

/**
 * HKDF-SHA256 output for each round. Round `i` uses IKM = key bytes, empty
 * salt, info = UTF-8 `info` followed by the single byte `i`, and
 * `32 + 2 · halfBytes` bytes: `hmacKey` = bytes 0..32, then `m` and `a` as
 * `halfBytes`-byte big-endian integers.
 */
function roundOkm(
  key: Uint8Array | string,
  info: string,
  rounds: number,
  halfBytes: number
): Buffer[] {
  const ikm = keyBytes(key);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 256) {
    throw new RangeError("rounds must be an integer in 1..256");
  }

  const infoBytes = Buffer.from(info, "utf8");
  const out: Buffer[] = [];
  for (let i = 0; i < rounds; i += 1) {
    out.push(
      Buffer.from(
        hkdfSync(
          "sha256",
          ikm,
          Buffer.alloc(0),
          Buffer.concat([infoBytes, Buffer.from([i])]),
          HMAC_KEY_BYTES + 2 * halfBytes
        )
      )
    );
  }

  return out;
}

/** Round keys for half widths 8..48 bits (multiples of 8). `m` is forced odd. */
export function deriveRoundKeys(
  key: Uint8Array | string,
  info: string,
  rounds: number,
  halfBits: number
): RoundKey[] {
  assertHalfBits(halfBits);
  const n = halfBits / 8;
  return roundOkm(key, info, rounds, n).map((okm) => {
    const rawM = okm.readUIntBE(HMAC_KEY_BYTES, n);
    return {
      a: okm.readUIntBE(HMAC_KEY_BYTES + n, n),
      hmacKey: new Uint8Array(okm.subarray(0, HMAC_KEY_BYTES)),
      // 2^halfBits is even, so rawM + 1 stays in range.
      m: rawM % 2 === 0 ? rawM + 1 : rawM,
    };
  });
}

/** Round keys for 64-bit halves. `m` is forced odd. */
export function deriveRoundKeys64(
  key: Uint8Array | string,
  info: string,
  rounds: number
): RoundKey64[] {
  return roundOkm(key, info, rounds, 8).map((okm) => ({
    a: okm.readBigUInt64BE(HMAC_KEY_BYTES + 8),
    hmacKey: new Uint8Array(okm.subarray(0, HMAC_KEY_BYTES)),
    m: okm.readBigUInt64BE(HMAC_KEY_BYTES) | 1n,
  }));
}

/**
 * Exact `(x · y) mod 2^48` for integers `x, y` in `[0, 2^48)`, using 24-bit
 * limbs so every intermediate stays below 2^53.
 */
export function mulMod48(x: number, y: number): number {
  const xl = x % TWO_24;
  const xh = (x - xl) / TWO_24;
  const yl = y % TWO_24;
  const yh = (y - yl) / TWO_24;
  const cross = (xh * yl + xl * yh) % TWO_24;
  return (xl * yl + cross * TWO_24) % TWO_48;
}

/**
 * Keyed bijection on `[0, 2^halfBits)`: `(r · m + a) mod 2^halfBits`, `m` odd.
 * Up to 32 bits this is `Math.imul`; above it uses exact 24-bit limbs.
 */
export function mulmix(r: number, k: RoundKey, halfBits: number): number {
  const mod = 2 ** halfBits;
  if (halfBits <= 32) {
    return ((Math.imul(r, k.m) >>> 0) + k.a) % mod;
  }

  return (mulMod48(r, k.m) + k.a) % mod;
}

/** 64-bit `mulmix`: `(r · m + a) mod 2^64`. */
export function mulmix64(r: bigint, k: RoundKey64): bigint {
  return (r * k.m + k.a) & MASK64;
}

/**
 * Round function for half widths up to 48 bits:
 * `F(R) = trunc_halfBits(HMAC-SHA256(hmacKey, mulmix(R) as BE bytes))`.
 */
export function roundFunction(
  r: number,
  k: RoundKey,
  halfBits: number
): number {
  const bytes = halfBits / 8;
  const input = Buffer.alloc(bytes);
  input.writeUIntBE(mulmix(r, k, halfBits), 0, bytes);
  const mac = createHmac("sha256", k.hmacKey).update(input).digest();
  return mac.readUIntBE(0, bytes);
}

/** Round function for 64-bit halves (BigInt), same construction. */
export function roundFunction64(r: bigint, k: RoundKey64): bigint {
  const input = Buffer.alloc(8);
  input.writeBigUInt64BE(mulmix64(r, k));
  const mac = createHmac("sha256", k.hmacKey).update(input).digest();
  return mac.readBigUInt64BE(0);
}

/** XOR two integers in `[0, 2^48)` without losing the high 16 bits. */
export function xor48(x: number, y: number): number {
  const xl = x % TWO_32;
  const yl = y % TWO_32;
  const xh = (x - xl) / TWO_32;
  const yh = (y - yl) / TWO_32;
  return (xh ^ yh) * TWO_32 + ((xl ^ yl) >>> 0);
}
