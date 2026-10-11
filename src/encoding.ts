/** Thrown when a string is not a well-formed ID, or fails `strictTime`. */
export class InvalidIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidIdError";
  }
}

/** Block widths `encodeBase64url` / `decodeBase64url` accept. */
export type Base64urlWidth = 32 | 64 | 96 | 128;

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Characters per width: `ceil(width / 6)`. */
const CHARS: Readonly<Record<Base64urlWidth, number>> = {
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
const TWO_32 = 2 ** 32;

function charsFor(width: unknown): number {
  if (width !== 32 && width !== 64 && width !== 96 && width !== 128) {
    throw new RangeError("width must be 32, 64, 96 or 128");
  }

  return CHARS[width];
}

/**
 * Encode an unsigned integer as big-endian base64url without padding: width
 * 32 takes a `number` (6 chars); 64, 96 and 128 take a `bigint` (11, 16 and 22
 * chars). Out-of-range or wrong-typed input throws `RangeError`.
 */
export function encodeBase64url(value: number, width: 32): string;
export function encodeBase64url(value: bigint, width: 64 | 96 | 128): string;
export function encodeBase64url(
  value: bigint | number,
  width: Base64urlWidth
): string;
export function encodeBase64url(
  value: bigint | number,
  width: Base64urlWidth
): string {
  const chars = charsFor(width);
  let v: bigint;
  if (width === 32) {
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 0 ||
      value >= TWO_32
    ) {
      throw new RangeError("width 32 value must be an integer in [0, 2^32)");
    }

    v = BigInt(value);
  } else {
    if (
      typeof value !== "bigint" ||
      value < ZERO ||
      value >> BigInt(width) !== ZERO
    ) {
      throw new RangeError(
        `width ${width} value must be a bigint in [0, 2^${width})`
      );
    }

    v = value;
  }

  const out = new Array<string>(chars);
  for (let i = chars - 1; i >= 0; i -= 1) {
    out[i] = ALPHABET.charAt(Number(v & MASK6));
    v >>= SIX;
  }

  return out.join("");
}

/**
 * Strictly decode base64url produced by {@link encodeBase64url}. A wrong
 * length, a character outside `[A-Za-z0-9_-]`, or nonzero unused high bits
 * throws {@link InvalidIdError}.
 */
export function decodeBase64url(text: string, width: 32): number;
export function decodeBase64url(text: string, width: 64 | 96 | 128): bigint;
export function decodeBase64url(
  text: string,
  width: Base64urlWidth
): bigint | number;
export function decodeBase64url(
  text: string,
  width: Base64urlWidth
): bigint | number {
  const chars = charsFor(width);
  if (typeof text !== "string" || text.length !== chars) {
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

  if (v >> BigInt(width) !== ZERO) {
    throw new InvalidIdError("id has non-canonical padding bits");
  }

  return width === 32 ? Number(v) : v;
}

const ID_CHARS = 16;
const BLOCK_BYTES = 12;
const ID_PATTERN = /^[A-Za-z0-9_-]{16}$/;

/**
 * Encode a 12-byte block as exactly 16 base64url characters (no padding).
 * Internal 0.1.0 byte path for the current keyed generator; not exported from
 * the package. The 0.2.0 keyed wrapper replaces it with {@link encodeBase64url}.
 */
export function encode16(block: Uint8Array): string {
  if (block.length !== BLOCK_BYTES) {
    throw new RangeError("block must be 12 bytes");
  }

  return Buffer.from(block.buffer, block.byteOffset, BLOCK_BYTES).toString(
    "base64url"
  );
}

/**
 * Decode exactly 16 base64url characters to a 12-byte block. Any other length,
 * or any character outside `[A-Za-z0-9_-]`, throws {@link InvalidIdError}.
 * @internal
 */
export function decode16(id: string): Uint8Array {
  if (typeof id !== "string" || id.length !== ID_CHARS) {
    throw new InvalidIdError("id must be exactly 16 characters");
  }

  if (!ID_PATTERN.test(id)) {
    throw new InvalidIdError("id must use only base64url characters");
  }

  return new Uint8Array(Buffer.from(id, "base64url"));
}
