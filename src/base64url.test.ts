import { describe, expect, it } from "vitest";

import type { Base64urlWidth } from "./encoding";

import { InvalidIdError, decodeBase64url, encodeBase64url } from "./encoding";

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const one = BigInt(1);
const maxOf = (w: number): bigint => (one << BigInt(w)) - one;

describe("encodeBase64url / decodeBase64url", () => {
  it("round-trips 0 and max at width 32 as numbers", () => {
    expect(encodeBase64url(0, 32)).toBe("AAAAAA");
    expect(encodeBase64url(2 ** 32 - 1, 32)).toBe("D_____");
    expect(decodeBase64url("AAAAAA", 32)).toBe(0);
    expect(decodeBase64url("D_____", 32)).toBe(2 ** 32 - 1);
    expect(decodeBase64url(encodeBase64url(0x12345678, 32), 32)).toBe(
      0x12345678
    );
  });

  it.each([
    [64, 11, "P__________"],
    [96, 16, "________________"],
    [128, 22, "D_____________________"],
  ] as const)("round-trips 0 and max at width %i", (width, chars, max) => {
    const zero = "A".repeat(chars);
    expect(encodeBase64url(BigInt(0), width)).toBe(zero);
    expect(encodeBase64url(maxOf(width), width)).toBe(max);
    expect(decodeBase64url(zero, width)).toBe(BigInt(0));
    expect(decodeBase64url(max, width)).toBe(maxOf(width));
    const v = maxOf(width) / BigInt(3);
    expect(decodeBase64url(encodeBase64url(v, width), width)).toBe(v);
  });

  it("is big-endian", () => {
    expect(encodeBase64url(1, 32)).toBe(`${"A".repeat(5)}B`);
    expect(encodeBase64url(one << BigInt(95), 96)).toBe("gAAAAAAAAAAAAAAA");
  });

  it("rejects out-of-range or wrong-typed values", () => {
    for (const bad of [-1, 2 ** 32, 1.5, Number.NaN]) {
      expect(() => encodeBase64url(bad, 32)).toThrow(RangeError);
    }

    expect(() => encodeBase64url(BigInt(1) as unknown as number, 32)).toThrow(
      RangeError
    );
    for (const w of [64, 96, 128] as const) {
      expect(() => encodeBase64url(-one, w)).toThrow(RangeError);
      expect(() => encodeBase64url(one << BigInt(w), w)).toThrow(RangeError);
      expect(() => encodeBase64url(1 as unknown as bigint, w)).toThrow(
        RangeError
      );
    }
  });

  it("rejects unsupported widths", () => {
    const w = 48 as unknown as Base64urlWidth;
    expect(() => encodeBase64url(one, w)).toThrow(RangeError);
    expect(() => decodeBase64url("AAAAAAAA", w)).toThrow(RangeError);
  });

  it("rejects wrong lengths", () => {
    for (const [w, chars] of [
      [32, 6],
      [64, 11],
      [96, 16],
      [128, 22],
    ] as const) {
      for (const n of [0, chars - 1, chars + 1]) {
        expect(() => decodeBase64url("A".repeat(n), w)).toThrow(InvalidIdError);
      }
    }

    expect(() => decodeBase64url(42 as unknown as string, 96)).toThrow(
      InvalidIdError
    );
  });

  it("rejects characters outside the alphabet", () => {
    for (const bad of ["+", "/", "=", " ", ".", "é", "\n", "\u{7f}"]) {
      expect(() => decodeBase64url(`${"A".repeat(15)}${bad}`, 96)).toThrow(
        InvalidIdError
      );
    }
  });

  it("rejects nonzero padding bits at 32, 64 and 128", () => {
    // 32: top 4 of 36 bits; 64: top 2 of 66; 128: top 4 of 132.
    expect(() => decodeBase64url("E_____", 32)).toThrow(InvalidIdError);
    expect(() => decodeBase64url("Q__________", 64)).toThrow(InvalidIdError);
    expect(() => decodeBase64url(`E${"A".repeat(21)}`, 128)).toThrow(
      InvalidIdError
    );
    for (const c of "EIQg") {
      expect(() => decodeBase64url(`${c}AAAAA`, 32)).toThrow(InvalidIdError);
    }
  });

  it("decodes every leading character at 96 (no padding bits)", () => {
    for (const c of ALPHABET) {
      const s = `${c}${"_".repeat(15)}`;
      expect(encodeBase64url(decodeBase64url(s, 96), 96)).toBe(s);
    }
  });

  it("names its error", () => {
    const err = new InvalidIdError("x");
    expect(err.name).toBe("InvalidIdError");
    expect(err).toBeInstanceOf(Error);
  });
});
