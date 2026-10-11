import { describe, expect, it } from "vitest";

import { InvalidIdError, decode16, encode16 } from "./encoding";

describe("encode16 / decode16", () => {
  it("maps 12 bytes to exactly 16 base64url characters and back", () => {
    expect(encode16(new Uint8Array(12))).toBe("AAAAAAAAAAAAAAAA");
    expect(encode16(new Uint8Array(12).fill(0xff))).toBe("________________");
    const bytes = new Uint8Array([
      0xfb, 0xef, 0xbe, 0xfb, 0xef, 0xbe, 0, 1, 2, 3, 4, 5,
    ]);
    const s = encode16(bytes);
    expect(s).toHaveLength(16);
    expect(s).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(s.startsWith("--")).toBe(true);
    expect(decode16(s)).toStrictEqual(bytes);
  });

  it("encodes offset views by their own bytes", () => {
    const backing = new Uint8Array(16).fill(0xff);
    backing.fill(0, 2, 14);
    expect(encode16(backing.subarray(2, 14))).toBe("AAAAAAAAAAAAAAAA");
  });

  it("rejects blocks that are not 12 bytes", () => {
    expect(() => encode16(new Uint8Array(11))).toThrow(RangeError);
    expect(() => encode16(new Uint8Array(13))).toThrow(RangeError);
  });

  it("rejects any length other than 16", () => {
    for (const s of ["", "A".repeat(15), "A".repeat(17), "A".repeat(24)]) {
      expect(() => decode16(s)).toThrow(InvalidIdError);
    }

    expect(() => decode16(42 as unknown as string)).toThrow(InvalidIdError);
  });

  it("rejects characters outside [A-Za-z0-9_-]", () => {
    for (const bad of ["+", "/", "=", " ", ".", "é", "\n"]) {
      expect(() => decode16(`${"A".repeat(15)}${bad}`)).toThrow(InvalidIdError);
    }
  });

  it("names its error", () => {
    const err = new InvalidIdError("x");
    expect(err.name).toBe("InvalidIdError");
    expect(err).toBeInstanceOf(Error);
  });
});
