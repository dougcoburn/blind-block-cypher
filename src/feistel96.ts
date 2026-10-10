import { type RoundKey, deriveRoundKeys, roundFunction, xor48 } from "./round";

/** Fixed round count for id96. Part of the format; not configurable. */
export const ID96_ROUNDS = 20;

/** HKDF info string for id96 round keys (domain-separated from u32). */
export const ID96_INFO = "blind-block-cypher/id96/v1";

const HALF_BITS = 48;
const BLOCK_BYTES = 12;

export interface Feistel96 {
  /** Decrypt a 12-byte block. Returns a new array. */
  decrypt(block: Uint8Array): Uint8Array;
  /** Encrypt a 12-byte block. Returns a new array. */
  encrypt(block: Uint8Array): Uint8Array;
}

function split(block: Uint8Array): [number, number] {
  if (!(block instanceof Uint8Array) || block.length !== BLOCK_BYTES) {
    throw new RangeError("block must be a 12-byte Uint8Array");
  }

  const buf = Buffer.from(block.buffer, block.byteOffset, BLOCK_BYTES);
  return [buf.readUIntBE(0, 6), buf.readUIntBE(6, 6)];
}

function join(left: number, right: number): Uint8Array {
  const out = Buffer.alloc(BLOCK_BYTES);
  out.writeUIntBE(left, 0, 6);
  out.writeUIntBE(right, 6, 6);
  return new Uint8Array(out.buffer, out.byteOffset, BLOCK_BYTES);
}

/**
 * Keyed 96-bit Feistel permutation: two 48-bit halves, {@link ID96_ROUNDS}
 * rounds, round keys from HKDF-SHA256 with info {@link ID96_INFO}.
 * Throws on an empty key.
 */
export function createFeistel96(key: Uint8Array | string): Feistel96 {
  const keys: RoundKey[] = deriveRoundKeys(
    key,
    ID96_INFO,
    ID96_ROUNDS,
    HALF_BITS
  );

  return {
    decrypt(block) {
      let [L, R] = split(block);
      for (let i = keys.length - 1; i >= 0; i -= 1) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- loop bounds
        const k = keys[i]!;
        const prevL = xor48(R, roundFunction(L, k, HALF_BITS));
        R = L;
        L = prevL;
      }

      return join(L, R);
    },
    encrypt(block) {
      let [L, R] = split(block);
      for (const k of keys) {
        const nextR = xor48(L, roundFunction(R, k, HALF_BITS));
        L = R;
        R = nextR;
      }

      return join(L, R);
    },
  };
}

/** One-shot {@link Feistel96.encrypt}; derives round keys on every call. */
export function encryptBlock(
  key: Uint8Array | string,
  block: Uint8Array
): Uint8Array {
  return createFeistel96(key).encrypt(block);
}

/** One-shot {@link Feistel96.decrypt}; derives round keys on every call. */
export function decryptBlock(
  key: Uint8Array | string,
  block: Uint8Array
): Uint8Array {
  return createFeistel96(key).decrypt(block);
}
