import { describe, expect, it } from "vitest";

import {
  CIPHER_INFO,
  CIPHER_ROUNDS,
  ID96_ROUNDS,
  createCipher,
} from "./cipher";

// Produced by `node scripts/cipher-reference.mjs`, an independent BigInt
// implementation with its own ROUNDS = 20. Fake key: never reuse it.
const KEY = "cipher-golden-key-not-for-production";
const GOLDEN: Record<32 | 64 | 96 | 128, [string, string][]> = {
  32: [
    ["0x0", "0xe993db96"],
    ["0x1", "0x8759e2cb"],
    ["0x12345678", "0xef2f88bb"],
    ["0xffffffff", "0xb10222e7"],
  ],
  64: [
    ["0x0", "0x82ed8d3c69694e8"],
    ["0x1", "0x481c156ce69206b2"],
    ["0x123456789abcdef", "0x31b2eca4cc944ba7"],
    ["0xffffffffffffffff", "0xb85ec1544ca31430"],
  ],
  96: [
    ["0x0", "0xcf1fbad7774daf17ef7c1008"],
    ["0x1", "0x996b7b07e4a81668fe76a172"],
    ["0x123456789abcdeffedcba98", "0x49aa80d98b76e08f6cab3991"],
    ["0xffffffffffffffffffffffff", "0xbaa1f2434a8f6afc41a2f92"],
  ],
  128: [
    ["0x0", "0x9c452ce3ed27e6275e9a3a6f4d06ebc1"],
    ["0x1", "0x89f9a9e47f2155c5eedd27a4f3123211"],
    ["0x123456789abcdeffedcba9876543210", "0x29a9fd9ea24762341f7fe98cef39ec27"],
    [
      "0xffffffffffffffffffffffffffffffff",
      "0xb0adda803151130305994c2312712178",
    ],
  ],
};

type Width = 32 | 64 | 96 | 128;
const WIDTHS: Width[] = [32, 64, 96, 128];

/** Width-generic wrapper over the cipher, in bigint. */
function ops(key: string, w: Width) {
  const c = createCipher(key);
  switch (w) {
    case 32:
      return {
        dec: (x: bigint) => BigInt(c.decrypt32(Number(x))),
        enc: (x: bigint) => BigInt(c.encrypt32(Number(x))),
      };
    case 64:
      return { dec: c.decrypt64, enc: c.encrypt64 };
    case 96:
      return { dec: c.decrypt96, enc: c.encrypt96 };
    case 128:
      return { dec: c.decrypt128, enc: c.encrypt128 };
  }
}

/** GF(2) rank of bigint row vectors. */
function rank(rows: bigint[]): number {
  const basis = new Map<number, bigint>(); // top bit -> row
  for (let r of rows) {
    while (r !== 0n) {
      const top = r.toString(2).length - 1;
      const b = basis.get(top);
      if (b === undefined) {
        basis.set(top, r);
        break;
      }

      r ^= b;
    }
  }

  return basis.size;
}

/** Ciphertext differences c(base + i) ^ c(base) for consecutive inputs. */
function diffs(enc: (x: bigint) => bigint, base: bigint, n = 300): bigint[] {
  const c0 = enc(base);
  const out: bigint[] = [];
  for (let i = 1n; i <= BigInt(n); i += 1n) {
    out.push(enc(base + i) ^ c0);
  }

  return out;
}

/** A 20-round Feistel with an affine F (XOR mask + rotation), any width. */
function affineCipher(w: Width): (x: bigint) => bigint {
  const h = BigInt(w / 2);
  const mask = (1n << h) - 1n;
  const rotl = (x: bigint, n: bigint) => ((x << n) | (x >> (h - n))) & mask;
  return (x) => {
    let L = x >> h;
    let R = x & mask;
    for (let i = 0n; i < 20n; i += 1n) {
      const f = rotl(
        R ^ ((0x5a5a5a5a5a5a5a5an * (i + 1n)) & mask),
        (i % (h - 1n)) + 1n
      );
      [L, R] = [R, L ^ f];
    }

    return (L << h) | R;
  };
}

describe("createCipher", () => {
  it("uses 20 rounds and per-width info strings", () => {
    expect(CIPHER_ROUNDS).toBe(20);
    expect(ID96_ROUNDS).toBe(20);
    expect(CIPHER_INFO).toStrictEqual({
      u32: "blind-block-cypher/u32/v2",
      u64: "blind-block-cypher/u64/v1",
      u96: "blind-block-cypher/id96/v1",
      u128: "blind-block-cypher/u128/v1",
    });
  });

  it("throws on an empty key", () => {
    expect(() => createCipher("")).toThrow(/non-empty/);
    expect(() => createCipher(new Uint8Array(0))).toThrow(/non-empty/);
  });

  it("treats a string key as its UTF-8 bytes", () => {
    const a = createCipher(KEY);
    const b = createCipher(new TextEncoder().encode(KEY));
    expect(b.encrypt32(7)).toBe(a.encrypt32(7));
    expect(b.encrypt128(7n)).toBe(a.encrypt128(7n));
  });

  it("is not affected by later mutation of a Uint8Array key", () => {
    const bytes = new TextEncoder().encode(KEY);
    const c = createCipher(bytes);
    bytes.fill(0);
    expect(c.encrypt64(0n)).toBe(BigInt(GOLDEN[64][0]?.[1] ?? ""));
  });
});

describe("golden vectors (independent reference)", () => {
  for (const w of WIDTHS) {
    it(`${w}-bit`, () => {
      const { dec, enc } = ops(KEY, w);
      for (const [plain, cipher] of GOLDEN[w]) {
        expect(enc(BigInt(plain))).toBe(BigInt(cipher));
        expect(dec(BigInt(cipher))).toBe(BigInt(plain));
      }
    });
  }

  it("encrypt32 returns plain numbers", () => {
    const c = createCipher(KEY);
    expect(c.encrypt32(0)).toBe(0xe993db96);
    expect(c.decrypt32(0xb10222e7)).toBe(0xffffffff);
  });
});

describe("round-trip", () => {
  for (const w of WIDTHS) {
    it(`${w}-bit at 0, 1, max-1, max and a sweep`, () => {
      const { dec, enc } = ops(KEY, w);
      const max = (1n << BigInt(w)) - 1n;
      const xs = [0n, 1n, 2n, max - 1n, max, max >> 1n, (max >> 1n) + 1n];
      for (let i = 0n; i < 50n; i += 1n) {
        xs.push((i * 0x9e3779b97f4a7c15f39cc0605cedc835n) & max);
      }

      const seen = new Set<bigint>();
      for (const x of xs) {
        const c = enc(x);
        expect(c >= 0n && c <= max).toBe(true);
        expect(dec(c)).toBe(x);
        seen.add(c);
      }

      expect(seen.size).toBe(new Set(xs).size);
    });
  }
});

describe("width and key separation", () => {
  it("the same numeric input differs across widths", () => {
    const c = createCipher(KEY);
    for (const x of [0n, 1n, 0x12345678n]) {
      const outs = [
        BigInt(c.encrypt32(Number(x))),
        c.encrypt64(x),
        c.encrypt96(x),
        c.encrypt128(x),
      ];
      expect(new Set(outs).size).toBe(4);
      // Even truncated to 32 bits, the widths are unrelated.
      expect(new Set(outs.map((o) => o & 0xffffffffn)).size).toBe(4);
    }
  });

  it("different keys give unrelated output", () => {
    const a = createCipher(KEY);
    const b = createCipher(`${KEY}!`);
    expect(a.encrypt32(0)).not.toBe(b.encrypt32(0));
    expect(a.encrypt64(0n)).not.toBe(b.encrypt64(0n));
    expect(a.encrypt96(0n)).not.toBe(b.encrypt96(0n));
    expect(a.encrypt128(0n)).not.toBe(b.encrypt128(0n));
  });
});

describe("strict validation", () => {
  const c = createCipher(KEY);

  it("32-bit: TypeError for non-numbers", () => {
    for (const bad of [0n, "1", null, undefined, {}]) {
      expect(() => c.encrypt32(bad as unknown as number)).toThrow(TypeError);
      expect(() => c.decrypt32(bad as unknown as number)).toThrow(TypeError);
    }
  });

  it("32-bit: RangeError out of range or non-integer (no >>> 0 wrap)", () => {
    for (const bad of [-1, 2 ** 32, 2 ** 32 + 5, 1.5, Number.NaN, Infinity]) {
      expect(() => c.encrypt32(bad)).toThrow(RangeError);
      expect(() => c.decrypt32(bad)).toThrow(RangeError);
    }
  });

  for (const w of [64, 96, 128] as const) {
    it(`${w}-bit: TypeError for non-bigints, RangeError out of range`, () => {
      const enc = (x: bigint) => c[`encrypt${w}`](x);
      const dec = (x: bigint) => c[`decrypt${w}`](x);
      for (const bad of [0, 1, "1", null]) {
        expect(() => enc(bad as unknown as bigint)).toThrow(TypeError);
        expect(() => dec(bad as unknown as bigint)).toThrow(TypeError);
      }

      for (const bad of [-1n, 1n << BigInt(w), (1n << BigInt(w)) + 1n]) {
        expect(() => enc(bad)).toThrow(RangeError);
        expect(() => dec(bad)).toThrow(RangeError);
      }
    });
  }
});

describe("non-affinity (GF(2) rank of ciphertext differences)", () => {
  for (const w of WIDTHS) {
    it(`${w}-bit reaches full rank ${w}`, () => {
      const { enc } = ops(KEY, w);
      expect(rank(diffs(enc, 1000n, w + 100))).toBe(w);
    });

    it(`${w}-bit check fails on an affine F`, () => {
      const r = rank(diffs(affineCipher(w), 1000n, w + 100));
      expect(r).toBeLessThan(w);
    });
  }
});
