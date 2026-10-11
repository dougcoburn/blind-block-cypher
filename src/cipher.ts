import {
  type RoundKey,
  type RoundKey64,
  deriveRoundKeys,
  deriveRoundKeys64,
  keyBytes,
  roundFunction,
  roundFunction64,
  xor48,
} from "./round";

/** Fixed Feistel round count for every width. Part of the format. */
export const CIPHER_ROUNDS = 20;

/** HKDF info strings, one per block width (domain separation). */
export const CIPHER_INFO = {
  u32: "blind-block-cypher/u32/v2",
  u64: "blind-block-cypher/u64/v1",
  u96: "blind-block-cypher/id96/v1",
  u128: "blind-block-cypher/u128/v1",
} as const;

/**
 * Keyed, format-preserving Feistel permutations on 32, 64, 96 and 128-bit
 * unsigned integers. Each method is a bijection on `[0, 2^width)`.
 *
 * Inputs are validated strictly (no `>>> 0` wrap): the 32-bit methods take a
 * `number` integer in `[0, 2^32)`; the 64/96/128-bit methods take a `bigint`
 * in `[0, 2^width)`. A wrong type throws `TypeError`; a non-integer or
 * out-of-range value throws `RangeError`.
 */
export interface Cipher {
  decrypt32: (x: number) => number;
  decrypt64: (x: bigint) => bigint;
  decrypt96: (x: bigint) => bigint;
  decrypt128: (x: bigint) => bigint;
  encrypt32: (x: number) => number;
  encrypt64: (x: bigint) => bigint;
  encrypt96: (x: bigint) => bigint;
  encrypt128: (x: bigint) => bigint;
}

function checkU32(x: unknown): number {
  if (typeof x !== "number") {
    throw new TypeError("encrypt32/decrypt32 expect a number");
  }

  if (!Number.isInteger(x) || x < 0 || x >= 2 ** 32) {
    throw new RangeError("value must be an integer in [0, 2^32)");
  }

  return x;
}

function checkBig(x: unknown, width: number): bigint {
  if (typeof x !== "bigint") {
    throw new TypeError(`${width}-bit methods expect a bigint`);
  }

  if (x < 0n || x >> BigInt(width) !== 0n) {
    throw new RangeError(`value must be a bigint in [0, 2^${width})`);
  }

  return x;
}

/** Balanced Feistel on Number halves (`halfBits` <= 48). */
function feistelNum(
  keys: RoundKey[],
  halfBits: number,
  L: number,
  R: number,
  decrypt: boolean
): [number, number] {
  if (decrypt) {
    for (let i = keys.length - 1; i >= 0; i -= 1) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- loop bounds
      const prevL = xor48(R, roundFunction(L, keys[i]!, halfBits));
      R = L;
      L = prevL;
    }
  } else {
    for (const k of keys) {
      const nextR = xor48(L, roundFunction(R, k, halfBits));
      L = R;
      R = nextR;
    }
  }

  return [L, R];
}

/** Balanced Feistel on 64-bit BigInt halves. */
function feistel64(
  keys: RoundKey64[],
  L: bigint,
  R: bigint,
  decrypt: boolean
): [bigint, bigint] {
  if (decrypt) {
    for (let i = keys.length - 1; i >= 0; i -= 1) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- loop bounds
      const prevL = R ^ roundFunction64(L, keys[i]!);
      R = L;
      L = prevL;
    }
  } else {
    for (const k of keys) {
      const nextR = L ^ roundFunction64(R, k);
      L = R;
      R = nextR;
    }
  }

  return [L, R];
}

/** Memoize a zero-argument function (lazy round-key derivation). */
function lazy<T>(make: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= make());
}

/**
 * Create a keyed cipher. `key` is a non-empty string (UTF-8) or `Uint8Array`.
 * A key of any other type throws `TypeError`; an empty key throws `RangeError`. Round keys for each width are derived on first use.
 */
export function createCipher(key: Uint8Array | string): Cipher {
  const ikm = new Uint8Array(keyBytes(key));
  const k32 = lazy(() =>
    deriveRoundKeys(ikm, CIPHER_INFO.u32, CIPHER_ROUNDS, 16)
  );
  const k64 = lazy(() =>
    deriveRoundKeys(ikm, CIPHER_INFO.u64, CIPHER_ROUNDS, 32)
  );
  const k96 = lazy(() =>
    deriveRoundKeys(ikm, CIPHER_INFO.u96, CIPHER_ROUNDS, 48)
  );
  const k128 = lazy(() =>
    deriveRoundKeys64(ikm, CIPHER_INFO.u128, CIPHER_ROUNDS)
  );

  const run32 = (x: number, decrypt: boolean) => {
    const v = checkU32(x);
    const [L, R] = feistelNum(
      k32(),
      16,
      Math.floor(v / 2 ** 16),
      v % 2 ** 16,
      decrypt
    );
    return L * 2 ** 16 + R;
  };

  const run64 = (x: bigint, decrypt: boolean) => {
    const v = checkBig(x, 64);
    const [L, R] = feistelNum(
      k64(),
      32,
      Number(v >> 32n),
      Number(v & 0xffffffffn),
      decrypt
    );
    return (BigInt(L) << 32n) | BigInt(R);
  };

  const run96 = (x: bigint, decrypt: boolean) => {
    const v = checkBig(x, 96);
    const [L, R] = feistelNum(
      k96(),
      48,
      Number(v >> 48n),
      Number(v & 0xffffffffffffn),
      decrypt
    );
    return (BigInt(L) << 48n) | BigInt(R);
  };

  const run128 = (x: bigint, decrypt: boolean) => {
    const v = checkBig(x, 128);
    const [L, R] = feistel64(
      k128(),
      v >> 64n,
      v & 0xffffffffffffffffn,
      decrypt
    );
    return (L << 64n) | R;
  };

  return {
    decrypt32: (x) => run32(x, true),
    decrypt64: (x) => run64(x, true),
    decrypt96: (x) => run96(x, true),
    decrypt128: (x) => run128(x, true),
    encrypt32: (x) => run32(x, false),
    encrypt64: (x) => run64(x, false),
    encrypt96: (x) => run96(x, false),
    encrypt128: (x) => run128(x, false),
  };
}
