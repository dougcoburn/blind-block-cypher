/** Thrown when a string is not a well-formed ID, or fails `strictTime`. */
export class InvalidIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidIdError";
  }
}

/** Block sizes in bits that `encodeBase64url` / `decodeBase64url` accept. */
export type Base64urlBits = 32 | 64 | 96 | 128;

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Characters per size: `ceil(bits / 6)` (RFC 4648 of `bits / 8` bytes). */
const CHARS: Readonly<Record<Base64urlBits, number>> = {
  32: 6,
  64: 11,
  96: 16,
  128: 22,
};

/** Char code to 6-bit value, or -1 outside the alphabet (ASCII only). */
const LOOKUP = new Int8Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i += 1) {
  LOOKUP[ALPHABET.charCodeAt(i)] = i;
}

const SIX = BigInt(6);
const MASK6 = BigInt(63);
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO_32 = 2 ** 32;

function charsFor(bits: unknown): number {
  if (bits !== 32 && bits !== 64 && bits !== 96 && bits !== 128) {
    throw new RangeError("bits must be 32, 64, 96 or 128");
  }

  return CHARS[bits];
}

/**
 * Encode an unsigned integer as RFC 4648 base64url (no `=` padding) of its
 * big-endian bytes: 32 bits take a `number` (4 bytes, 6 chars); 64, 96 and 128
 * take a `bigint` (8, 12 and 16 bytes; 11, 16 and 22 chars). Unused bits are
 * trailing zeros in the last character. A wrong JS type throws `TypeError`;
 * an out-of-range value or unsupported `bits` throws `RangeError`.
 */
export function encodeBase64url(value: number, bits: 32): string;
export function encodeBase64url(value: bigint, bits: 64 | 96 | 128): string;
export function encodeBase64url(
  value: bigint | number,
  bits: Base64urlBits
): string;
export function encodeBase64url(
  value: bigint | number,
  bits: Base64urlBits
): string {
  const chars = charsFor(bits);
  let v: bigint;
  if (bits === 32) {
    if (typeof value !== "number") {
      throw new TypeError("32-bit value must be a number");
    }

    if (!Number.isInteger(value) || value < 0 || value >= TWO_32) {
      throw new RangeError("32-bit value must be an integer in [0, 2^32)");
    }

    v = BigInt(value);
  } else {
    if (typeof value !== "bigint") {
      throw new TypeError(`${bits}-bit value must be a bigint`);
    }

    if (value < ZERO || value >> BigInt(bits) !== ZERO) {
      throw new RangeError(`${bits}-bit value must be in [0, 2^${bits})`);
    }

    v = value;
  }

  v <<= BigInt(chars * 6 - bits);
  const out = new Array<string>(chars);
  for (let i = chars - 1; i >= 0; i -= 1) {
    out[i] = ALPHABET.charAt(Number(v & MASK6));
    v >>= SIX;
  }

  return out.join("");
}

/**
 * Strictly decode base64url produced by {@link encodeBase64url}. A wrong
 * length, a character outside `[A-Za-z0-9_-]`, or nonzero trailing pad bits
 * throws {@link InvalidIdError}; non-string `text` throws `TypeError`.
 */
export function decodeBase64url(text: string, bits: 32): number;
export function decodeBase64url(text: string, bits: 64 | 96 | 128): bigint;
export function decodeBase64url(
  text: string,
  bits: Base64urlBits
): bigint | number;
export function decodeBase64url(
  text: string,
  bits: Base64urlBits
): bigint | number {
  const chars = charsFor(bits);
  if (typeof text !== "string") {
    throw new TypeError("text must be a string");
  }

  if (text.length !== chars) {
    throw new InvalidIdError(`id must be exactly ${chars} characters`);
  }

  let v = ZERO;
  for (let i = 0; i < chars; i += 1) {
    const digit = LOOKUP[text.charCodeAt(i)] ?? -1;
    if (digit < 0) {
      throw new InvalidIdError("id must use only base64url characters");
    }

    v = (v << SIX) | BigInt(digit);
  }

  const pad = BigInt(chars * 6 - bits);
  if ((v & ((ONE << pad) - ONE)) !== ZERO) {
    throw new InvalidIdError("id has non-canonical trailing pad bits");
  }

  v >>= pad;
  return bits === 32 ? Number(v) : v;
}
