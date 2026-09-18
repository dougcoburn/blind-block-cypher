import { type RoundMaterial, expandKey } from "./expand";
import permutation from "./permutation";

/** Recommended Feistel round count for ID obfuscation. */
export const RECOMMENDED_ROUNDS = 8;

function asU32(n: number): number {
  return n >>> 0;
}

function left16(block: number): number {
  return (asU32(block) >>> 16) & 0xffff;
}

function right16(block: number): number {
  return asU32(block) & 0xffff;
}

function join(left: number, right: number): number {
  return (((left & 0xffff) << 16) | (right & 0xffff)) >>> 0;
}

/** Place input bit `order[i]` into output bit `i`. */
function shuffleBits(value16: number, order: number[]): number {
  let out = 0;
  for (let i = 0; i < 16; i += 1) {
    const src = order[i] ?? 0;
    if ((value16 >>> src) & 1) {
      out |= 1 << i;
    }
  }

  return out & 0xffff;
}

/**
 * Round function F: XOR with per-round mask, then keyed 16-bit bit shuffle
 * via permutation(16, shuffleId). Need not be invertible (Feistel XOR).
 */
function F(half: number, round: RoundMaterial): number {
  const masked = (half ^ round.mask) & 0xffff;
  const order = permutation(16, round.shuffleId);
  return shuffleBits(masked, order);
}

function assertKeyAndRounds(
  key: Uint8Array | string,
  rounds: number
): RoundMaterial[] {
  return expandKey(key, rounds);
}

/**
 * Encrypt a u32 block. Same (key, rounds) is deterministic.
 * Rejects empty key and rounds < 1.
 */
export function encrypt(
  key: Uint8Array | string,
  rounds: number,
  plaintext: number
): number {
  const material = assertKeyAndRounds(key, rounds);
  let L = left16(plaintext);
  let R = right16(plaintext);

  for (const round of material) {
    const nextL = R;
    const nextR = (L ^ F(R, round)) & 0xffff;
    L = nextL;
    R = nextR;
  }

  return join(L, R);
}

/**
 * Decrypt a u32 block. Inverse of encrypt for the same (key, rounds).
 */
export function decrypt(
  key: Uint8Array | string,
  rounds: number,
  ciphertext: number
): number {
  const material = assertKeyAndRounds(key, rounds);
  let L = left16(ciphertext);
  let R = right16(ciphertext);

  for (let i = material.length - 1; i >= 0; i -= 1) {
    const round = material[i];
    if (round === undefined) {
      continue;
    }

    const prevR = L;
    const prevL = (R ^ F(L, round)) & 0xffff;
    L = prevL;
    R = prevR;
  }

  return join(L, R);
}
