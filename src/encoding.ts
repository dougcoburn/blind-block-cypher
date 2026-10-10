/** Thrown when a string is not a well-formed id96 ID, or fails `strictTime`. */
export class InvalidIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidIdError";
  }
}

const ID_CHARS = 16;
const BLOCK_BYTES = 12;
const ID_PATTERN = /^[A-Za-z0-9_-]{16}$/;

/** Encode a 12-byte block as exactly 16 base64url characters (no padding). */
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
