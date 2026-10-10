import { createHmac, hkdfSync } from "node:crypto";

/** Per-round key material derived by {@link deriveRoundKeys}. */
export interface RoundKey {
  /** Additive constant for `mulmix`, reduced mod 2^halfBits. */
  a: number;
  /** HMAC-SHA256 key for the round function. */
  hmacKey: Buffer;
  /** Odd multiplier for `mulmix`, reduced mod 2^halfBits. */
  m: number;
}

const OKM_BYTES = 44;
const TWO_24 = 2 ** 24;
const TWO_48 = 2 ** 48;

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

function readUint48(buf: Buffer, offset: number): number {
  return buf.readUIntBE(offset, 6);
}

/**
 * Derive one {@link RoundKey} per round with HKDF-SHA256.
 *
 * Round `i` uses IKM = key bytes, empty salt, info = UTF-8 `info` followed by
 * the single byte `i`, and 44 bytes of output: `hmacKey` = bytes 0..32,
 * `m` = bytes 32..38 (48-bit BE, forced odd), `a` = bytes 38..44 (48-bit BE).
 * Both `m` and `a` are reduced mod 2^halfBits.
 */
export function deriveRoundKeys(
  key: Uint8Array | string,
  info: string,
  rounds: number,
  halfBits: number
): RoundKey[] {
  const ikm =
    typeof key === "string" ? Buffer.from(key, "utf8") : Buffer.from(key);
  if (ikm.length === 0) {
    throw new Error("key must be non-empty");
  }

  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 256) {
    throw new RangeError("rounds must be an integer in 1..256");
  }

  assertHalfBits(halfBits);
  const mod = 2 ** halfBits;
  const infoBytes = Buffer.from(info, "utf8");
  const keys: RoundKey[] = [];
  for (let i = 0; i < rounds; i += 1) {
    const okm = Buffer.from(
      hkdfSync(
        "sha256",
        ikm,
        Buffer.alloc(0),
        Buffer.concat([infoBytes, Buffer.from([i])]),
        OKM_BYTES
      )
    );
    const rawM = readUint48(okm, 32) % mod;
    keys.push({
      a: readUint48(okm, 38) % mod,
      hmacKey: okm.subarray(0, 32),
      // mod is even, so rawM + 1 stays below it.
      m: rawM % 2 === 0 ? rawM + 1 : rawM,
    });
  }

  return keys;
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

/** Keyed bijection on `[0, 2^halfBits)`: `(r · m + a) mod 2^halfBits`, `m` odd. */
export function mulmix(r: number, k: RoundKey, halfBits: number): number {
  const mod = 2 ** halfBits;
  return (mulMod48(r, k.m) + k.a) % mod;
}

/**
 * Round function shared by the Feistel ciphers:
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

/** XOR two integers in `[0, 2^48)` without losing the high 16 bits. */
export function xor48(x: number, y: number): number {
  const TWO_32 = 2 ** 32;
  const xl = x % TWO_32;
  const yl = y % TWO_32;
  const xh = (x - xl) / TWO_32;
  const yh = (y - yl) / TWO_32;
  return (xh ^ yh) * TWO_32 + ((xl ^ yl) >>> 0);
}
