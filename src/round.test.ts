import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  assertHalfBits,
  deriveRoundKeys,
  mulMod48,
  mulmix,
  roundFunction,
  xor48,
} from "./round";

const KEY = "round-test-key-not-for-production";
const INFO = "blind-block-cypher/id96/v1";
const TWO_48 = 2 ** 48;

describe("deriveRoundKeys", () => {
  it("rejects an empty key", () => {
    expect(() => deriveRoundKeys("", INFO, 20, 48)).toThrow(/non-empty/);
    expect(() => deriveRoundKeys(new Uint8Array(0), INFO, 20, 48)).toThrow(
      /non-empty/
    );
  });

  it("rejects bad round counts", () => {
    for (const rounds of [0, -1, 1.5, 257, Number.NaN]) {
      expect(() => deriveRoundKeys(KEY, INFO, rounds, 48)).toThrow(RangeError);
    }
  });

  it("rejects bad half widths", () => {
    for (const halfBits of [0, 7, 12, 56, 1.5, Number.NaN]) {
      expect(() => deriveRoundKeys(KEY, INFO, 20, halfBits)).toThrow(
        RangeError
      );
    }

    expect(() => assertHalfBits(8)).not.toThrow();
    expect(() => assertHalfBits(48)).not.toThrow();
  });

  it("derives odd multipliers and in-range constants", () => {
    for (const halfBits of [8, 32, 48]) {
      const keys = deriveRoundKeys(KEY, INFO, 64, halfBits);
      expect(keys).toHaveLength(64);
      for (const k of keys) {
        expect(k.m % 2).toBe(1);
        expect(k.m).toBeLessThan(2 ** halfBits);
        expect(k.a).toBeGreaterThanOrEqual(0);
        expect(k.a).toBeLessThan(2 ** halfBits);
        expect(k.hmacKey).toHaveLength(32);
      }
    }
  });

  it("treats a string key as its UTF-8 bytes", () => {
    const a = deriveRoundKeys(KEY, INFO, 3, 48);
    const b = deriveRoundKeys(new TextEncoder().encode(KEY), INFO, 3, 48);
    expect(b).toStrictEqual(a);
  });

  it("separates domains by info string and round index", () => {
    const id96 = deriveRoundKeys(KEY, INFO, 2, 48);
    const other = deriveRoundKeys(KEY, "blind-block-cypher/other", 2, 48);
    expect(other[0]?.hmacKey).not.toStrictEqual(id96[0]?.hmacKey);
    expect(id96[1]?.hmacKey).not.toStrictEqual(id96[0]?.hmacKey);
  });

  it("gives the same prefix for fewer rounds", () => {
    expect(deriveRoundKeys(KEY, INFO, 10, 48)).toStrictEqual(
      deriveRoundKeys(KEY, INFO, 20, 48).slice(0, 10)
    );
  });
});

describe("mulMod48", () => {
  it("is exact at the edges", () => {
    expect(mulMod48(0, TWO_48 - 1)).toBe(0);
    expect(mulMod48(1, TWO_48 - 1)).toBe(TWO_48 - 1);
    // (2^48 - 1)^2 = 2^96 - 2^49 + 1 ≡ 1 (mod 2^48)
    expect(mulMod48(TWO_48 - 1, TWO_48 - 1)).toBe(1);
    // 2^24 · 2^24 = 2^48 ≡ 0
    expect(mulMod48(2 ** 24, 2 ** 24)).toBe(0);
    // (2^24 + 1)^2 = 2^48 + 2^25 + 1 ≡ 2^25 + 1
    expect(mulMod48(2 ** 24 + 1, 2 ** 24 + 1)).toBe(2 ** 25 + 1);
  });

  it("matches small exact products", () => {
    expect(mulMod48(123_456, 789_012)).toBe(123_456 * 789_012);
  });
});

describe("mulmix", () => {
  it("is a bijection on 8-bit inputs", () => {
    const [k] = deriveRoundKeys(KEY, INFO, 1, 8);
    const seen = new Set<number>();
    for (let r = 0; r < 256; r += 1) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- one key
      seen.add(mulmix(r, k!, 8));
    }

    expect(seen.size).toBe(256);
  });

  it("matches (r·m + a) mod 2^32 computed with Math.imul", () => {
    const keys = deriveRoundKeys(KEY, INFO, 5, 32);
    for (const k of keys) {
      for (const r of [0, 1, 0xdeadbeef, 0xffffffff]) {
        expect(mulmix(r, k, 32)).toBe((Math.imul(r, k.m) + k.a) >>> 0);
      }
    }
  });
});

describe("roundFunction", () => {
  it("returns values of the half width", () => {
    for (const halfBits of [8, 48]) {
      const keys = deriveRoundKeys(KEY, INFO, 4, halfBits);
      for (const k of keys) {
        const out = roundFunction(5, k, halfBits);
        expect(Number.isInteger(out)).toBe(true);
        expect(out).toBeGreaterThanOrEqual(0);
        expect(out).toBeLessThan(2 ** halfBits);
      }
    }
  });

  it("depends on the round key", () => {
    const [k0, k1] = deriveRoundKeys(KEY, INFO, 2, 48);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- two keys
    expect(roundFunction(42, k0!, 48)).not.toBe(roundFunction(42, k1!, 48));
  });
});

describe("xor48", () => {
  it("XORs all 48 bits", () => {
    expect(xor48(0, 0)).toBe(0);
    expect(xor48(TWO_48 - 1, 0)).toBe(TWO_48 - 1);
    expect(xor48(TWO_48 - 1, TWO_48 - 1)).toBe(0);
    expect(xor48(2 ** 47, 1)).toBe(2 ** 47 + 1);
    expect(xor48(0xffff_0000_0000, 0x0000_ffff_ffff)).toBe(TWO_48 - 1);
  });
});

describe("roundFunction HMAC", () => {
  it("equals HMAC-SHA256 of the mulmix bytes, truncated", () => {
    for (const halfBits of [8, 32, 48]) {
      for (const k of deriveRoundKeys(KEY, INFO, 3, halfBits)) {
        for (const r of [0, 1, 2 ** halfBits - 1]) {
          const bytes = halfBits / 8;
          const input = Buffer.alloc(bytes);
          input.writeUIntBE(mulmix(r, k, halfBits), 0, bytes);
          const expected = createHmac("sha256", k.hmacKey)
            .update(input)
            .digest()
            .readUIntBE(0, bytes);
          expect(roundFunction(r, k, halfBits)).toBe(expected);
        }
      }
    }
  });
});
