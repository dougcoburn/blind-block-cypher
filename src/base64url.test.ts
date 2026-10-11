// cspell:ignore AEIMQUYcgkosw unpadded
import { describe, expect, it } from "vitest";

import type { Base64urlBits } from "./encoding";

import { InvalidIdError, decodeBase64url, encodeBase64url } from "./encoding";

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const one = BigInt(1);
const maxOf = (bits: number): bigint => (one << BigInt(bits)) - one;

/** RFC 4648 base64url (unpadded) of the big-endian bytes, via Buffer. */
function reference(value: bigint, bits: number): string {
  const hex = value.toString(16).padStart(bits / 4, "0");
  return Buffer.from(hex, "hex").toString("base64url");
}

describe("encodeBase64url / decodeBase64url", () => {
  it("matches PM's verified vectors at 32 bits (number)", () => {
    for (const [v, s] of [
      [0, "AAAAAA"],
      [2 ** 32 - 1, "_____w"],
      [42, "AAAAKg"],
    ] as const) {
      expect(encodeBase64url(v, 32)).toBe(s);
      expect(decodeBase64url(s, 32)).toBe(v);
    }
  });

  it.each([
    [64, "AAAAAAAAAAA", "__________8", "AAAAAAAAACo"],
    [96, "AAAAAAAAAAAAAAAA", "________________", "AAAAAAAAAAAAAAAq"],
    [
      128,
      "AAAAAAAAAAAAAAAAAAAAAA",
      "_____________________w",
      "AAAAAAAAAAAAAAAAAAAAKg",
    ],
  ] as const)("matches PM's verified vectors at %i bits", (bits, z, m, ft) => {
    for (const [v, s] of [
      [BigInt(0), z],
      [maxOf(bits), m],
      [BigInt(42), ft],
    ] as const) {
      expect(encodeBase64url(v, bits)).toBe(s);
      expect(decodeBase64url(s, bits)).toBe(v);
    }
  });

  it("equals RFC 4648 base64url of the big-endian bytes", () => {
    for (const bits of [64, 96, 128] as const) {
      for (const v of [maxOf(bits) / BigInt(3), maxOf(bits) / BigInt(7)]) {
        const s = encodeBase64url(v, bits);
        expect(s).toBe(reference(v, bits));
        expect(decodeBase64url(s, bits)).toBe(v);
      }
    }

    expect(encodeBase64url(0x12345678, 32)).toBe(
      reference(BigInt(0x12345678), 32)
    );
  });

  it("throws TypeError for the wrong JS type", () => {
    expect(() => encodeBase64url(one as unknown as number, 32)).toThrow(
      TypeError
    );
    for (const bits of [64, 96, 128] as const) {
      expect(() => encodeBase64url(1 as unknown as bigint, bits)).toThrow(
        TypeError
      );
    }

    expect(() => decodeBase64url(42 as unknown as string, 96)).toThrow(
      TypeError
    );
  });

  it("throws RangeError for out-of-range values or unsupported bits", () => {
    for (const bad of [-1, 2 ** 32, 1.5, Number.NaN]) {
      expect(() => encodeBase64url(bad, 32)).toThrow(RangeError);
    }

    for (const bits of [64, 96, 128] as const) {
      expect(() => encodeBase64url(-one, bits)).toThrow(RangeError);
      expect(() => encodeBase64url(one << BigInt(bits), bits)).toThrow(
        RangeError
      );
    }

    const bits = 48 as unknown as Base64urlBits;
    expect(() => encodeBase64url(one, bits)).toThrow(RangeError);
    expect(() => decodeBase64url("AAAAAAAA", bits)).toThrow(RangeError);
  });

  it("rejects wrong lengths", () => {
    for (const [bits, chars] of [
      [32, 6],
      [64, 11],
      [96, 16],
      [128, 22],
    ] as const) {
      for (const n of [0, chars - 1, chars + 1, chars + 2]) {
        expect(() => decodeBase64url("A".repeat(n), bits)).toThrow(
          InvalidIdError
        );
      }
    }
  });

  it("rejects characters outside the alphabet", () => {
    for (const bad of ["+", "/", "=", " ", ".", "é", "\n", "\u{7f}"]) {
      expect(() => decodeBase64url(`${bad}${"A".repeat(15)}`, 96)).toThrow(
        InvalidIdError
      );
    }

    expect(() => decodeBase64url("AAAAA=", 32)).toThrow(InvalidIdError);
  });

  it.each([
    [32, 6, "AQgw"],
    [64, 11, "AEIMQUYcgkosw048"],
    [128, 22, "AQgw"],
  ] as const)(
    "accepts only canonical last chars at %i bits",
    (bits, chars, allowed) => {
      const head = "A".repeat(chars - 1);
      for (const c of ALPHABET) {
        const s = `${head}${c}`;
        if (allowed.includes(c)) {
          expect(encodeBase64url(decodeBase64url(s, bits), bits)).toBe(s);
        } else {
          expect(() => decodeBase64url(s, bits)).toThrow(InvalidIdError);
        }
      }
    }
  );

  it.each([
    [32, "_____w"],
    [64, "__________8"],
    [128, "_____________________w"],
  ] as const)("rejects each pad-bit flip of max at %i bits", (bits, max) => {
    const pad = max.length * 6 - bits;
    const last = ALPHABET.indexOf(max.charAt(max.length - 1));
    for (let b = 0; b < pad; b += 1) {
      const s = `${max.slice(0, -1)}${ALPHABET.charAt(last ^ (1 << b))}`;
      expect(() => decodeBase64url(s, bits)).toThrow(InvalidIdError);
    }
  });

  it("decodes every 16-char string at 96 bits (no pad bits)", () => {
    for (const a of ALPHABET) {
      for (const b of ALPHABET) {
        const s = `${a}${"-".repeat(7)}${b}${"_".repeat(7)}`;
        expect(encodeBase64url(decodeBase64url(s, 96), 96)).toBe(s);
      }
    }

    // Every last char is canonical at 96.
    for (const c of ALPHABET) {
      const s = `${"A".repeat(15)}${c}`;
      expect(reference(decodeBase64url(s, 96), 96)).toBe(s);
    }
  });

  it("names its error", () => {
    const err = new InvalidIdError("x");
    expect(err.name).toBe("InvalidIdError");
    expect(err).toBeInstanceOf(Error);
  });
});
