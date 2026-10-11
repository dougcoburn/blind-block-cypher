import { describe, expect, it } from "vitest";

import { decode16, encode16 } from "./encoding";
import { ID96_INFO, createFeistel96 } from "./feistel96";
import { DEFAULT_EPOCH_MS, createIdGenerator } from "./generator";
import { deriveRoundKeys, roundFunction, xor48 } from "./round";

// Produced by `node scripts/id96-reference.mjs`, an independent BigInt
// implementation with its own ROUNDS = 20 constant. Fake key: never reuse it.
const KEY = "golden-vector-key-not-for-production";
/* cspell:disable -- base64url golden IDs */
const VECTORS = [
  {
    generatorId: 0,
    id: "-Xj3VuUqnIUo2TKi",
    nowMs: 1779571278900,
    plaintextHex: "005e30a7000123456789abcd",
    rng: [0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd],
    seconds: 12345678,
    sequence: 320255973501901,
  },
  {
    generatorId: 0,
    id: "eEz47-2jmdnFYJPN",
    nowMs: 1779571278900,
    plaintextHex: "005e30a7000123456789abce",
    rng: [0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd],
    seconds: 12345678,
    sequence: 320255973501902,
  },
  {
    generatorId: 1023,
    id: "SLcusYbmSUWH5DkM",
    nowMs: 10357160191500,
    plaintextHex: "ffffffffffffffffffffffff",
    rng: [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
    seconds: 8589934591,
    sequence: 9007199254740991,
  },
  {
    generatorId: 1023,
    id: "WYHFiVVs1WC3MIlU",
    nowMs: 10357160191500,
    plaintextHex: "ffffffffffe0000000000000",
    rng: [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
    seconds: 8589934591,
    sequence: 0,
  },
];
/* cspell:enable */

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

/** Bit `i` (0 = least significant) of a 96-bit big-endian block. */
function bit(block: Uint8Array, i: number): number {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- i < 96
  return (block[11 - (i >> 3)]! >> (i & 7)) & 1;
}

/** Read bits [lo, lo + width) of a 96-bit block as a Number (width <= 53). */
function field(block: Uint8Array, lo: number, width: number): number {
  let v = 0;
  for (let i = lo + width - 1; i >= lo; i -= 1) {
    v = v * 2 + bit(block, i);
  }

  return v;
}

/** GF(2) rank of 96-bit vectors, each as 3 u32 words. */
function rank96(rows: number[][]): number {
  const m = rows.map((r) => r.slice());
  let rank = 0;
  for (let col = 0; col < 96 && rank < m.length; col += 1) {
    const w = col >> 5;
    const mask = 1 << (col & 31);
    const pivot = m.findIndex(
      (r, i) => i >= rank && ((r[w] ?? 0) & mask) !== 0
    );
    if (pivot < 0) {
      continue;
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- in range
    [m[rank], m[pivot]] = [m[pivot]!, m[rank]!];
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- in range
    const p = m[rank]!;
    for (let i = 0; i < m.length; i += 1) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- in range
      const r = m[i]!;
      if (i !== rank && ((r[w] ?? 0) & mask) !== 0) {
        for (let k = 0; k < 3; k += 1) {
          r[k] = ((r[k] ?? 0) ^ (p[k] ?? 0)) >>> 0;
        }
      }
    }

    rank += 1;
  }

  return rank;
}

function words(block: Uint8Array): number[] {
  const b = Buffer.from(block);
  return [b.readUInt32BE(0), b.readUInt32BE(4), b.readUInt32BE(8)];
}

/** Ciphertext differences c_i ⊕ c_0 for same-second, same-generator blocks. */
function sameSecondDiffs(encrypt: (b: Uint8Array) => Uint8Array): number[][] {
  const base = Buffer.alloc(12);
  base.writeUIntBE((1_000_000 * 1024 + 7) * 32, 0, 6);
  const c0 = words(encrypt(base));
  const rows: number[][] = [];
  for (let seq = 1; seq <= 300; seq += 1) {
    const b = Buffer.from(base);
    b.writeUIntBE(seq, 6, 6);
    const c = words(encrypt(b));
    rows.push(c.map((x, k) => (x ^ (c0[k] ?? 0)) >>> 0));
  }

  return rows;
}

function feistel(
  rounds: number,
  F: (r: number, round: number) => number
): (b: Uint8Array) => Uint8Array {
  return (block) => {
    const buf = Buffer.from(block);
    let L = buf.readUIntBE(0, 6);
    let R = buf.readUIntBE(6, 6);
    for (let i = 0; i < rounds; i += 1) {
      [L, R] = [R, xor48(L, F(R, i))];
    }

    const out = Buffer.alloc(12);
    out.writeUIntBE(L, 0, 6);
    out.writeUIntBE(R, 6, 6);
    return new Uint8Array(out);
  };
}

describe("id96 golden vectors (20 rounds, independent reference)", () => {
  for (const v of VECTORS) {
    it(`generatorId ${v.generatorId}, sequence ${v.sequence}`, () => {
      const g = createIdGenerator(KEY, {
        generatorId: v.generatorId,
        now: () => v.nowMs,
        randomBytes: () => new Uint8Array(v.rng),
      });
      const ids = [g.generate(), g.generate()];
      expect(ids).toContain(v.id);
      expect(g.decode(v.id)).toStrictEqual({
        date: new Date(DEFAULT_EPOCH_MS + v.seconds * 1000),
        generatorId: v.generatorId,
        seconds: v.seconds,
        sequence: v.sequence,
      });

      // Bit positions: seconds = bits 95..63, generatorId = 62..53, sequence = 52..0.
      const plain = createFeistel96(KEY).decrypt(decode16(v.id));
      expect(hex(plain)).toBe(v.plaintextHex);
      expect(field(plain, 63, 33)).toBe(v.seconds);
      expect(field(plain, 53, 10)).toBe(v.generatorId);
      expect(field(plain, 0, 53)).toBe(v.sequence);
    });
  }

  it("10-round output does NOT match the 20-round vector", () => {
    const keys = deriveRoundKeys(KEY, ID96_INFO, 10, 48);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- 10 keys
    const tenRounds = feistel(10, (r, i) => roundFunction(r, keys[i]!, 48));
    for (const v of VECTORS) {
      const plain = new Uint8Array(Buffer.from(v.plaintextHex, "hex"));
      expect(encode16(tenRounds(plain))).not.toBe(v.id);
    }
  });

  it("a hand-rolled 20-round Feistel on the same round keys matches", () => {
    const keys = deriveRoundKeys(KEY, ID96_INFO, 20, 48);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- 20 keys
    const twenty = feistel(20, (r, i) => roundFunction(r, keys[i]!, 48));
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-empty
    const v = VECTORS[0]!;
    const plain = new Uint8Array(Buffer.from(v.plaintextHex, "hex"));
    expect(encode16(twenty(plain))).toBe(v.id);
  });
});

describe("id96 non-affinity", () => {
  it("same-second ciphertext differences reach full rank 96", () => {
    const f = createFeistel96(KEY);
    expect(rank96(sameSecondDiffs((b) => f.encrypt(b)))).toBe(96);
  });

  it("the same check fails on an affine (XOR-mask + bit-shuffle style) F", () => {
    // Old u32 F was XOR with a mask then a bit permutation: affine over GF(2).
    // Model it at 48 bits as a mask XOR plus a fixed rotation.
    const rot = (x: number, n: number) => {
      const TWO_48 = 2 ** 48;
      const hi = Math.floor(x / 2 ** (48 - n));
      return ((x * 2 ** n) % TWO_48) + hi;
    };

    const affine = feistel(20, (r, i) =>
      rot(xor48(r, 0x5a5a_a5a5_0f0f + i), (i % 47) + 1)
    );
    expect(rank96(sameSecondDiffs(affine))).toBeLessThan(96);
  });
});
