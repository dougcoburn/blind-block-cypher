import { describe, expect, it } from "vitest";

import {
  RECOMMENDED_ROUNDS,
  decrypt,
  encrypt,
  expandKey,
} from "./index";

const KEY = "test-key";
const OTHER_KEY = "other-key";

describe("RECOMMENDED_ROUNDS", () => {
  it("is 8", () => {
    expect(RECOMMENDED_ROUNDS).toBe(8);
  });
});

describe("expandKey", () => {
  it("rejects empty string key", () => {
    expect(() => expandKey("", 8)).toThrow(/non-empty/);
  });

  it("rejects empty Uint8Array key", () => {
    expect(() => expandKey(new Uint8Array(0), 8)).toThrow(/non-empty/);
  });

  it("rejects rounds < 1", () => {
    expect(() => expandKey(KEY, 0)).toThrow(/rounds/);
    expect(() => expandKey(KEY, -1)).toThrow(/rounds/);
  });

  it("rejects non-integer rounds", () => {
    expect(() => expandKey(KEY, 1.5)).toThrow(/rounds/);
  });

  it("returns one RoundMaterial per round", () => {
    const material = expandKey(KEY, 3);
    expect(material).toHaveLength(3);
    for (const round of material) {
      expect(round.mask).toBeGreaterThanOrEqual(0);
      expect(round.mask).toBeLessThanOrEqual(0xffff);
      expect(Number.isInteger(round.shuffleId)).toBe(true);
      expect(round.shuffleId).toBeGreaterThanOrEqual(0);
    }
  });

  it("is deterministic for the same key and rounds", () => {
    expect(expandKey(KEY, 8)).toStrictEqual(expandKey(KEY, 8));
    const bytes = new TextEncoder().encode(KEY);
    expect(expandKey(bytes, 4)).toStrictEqual(expandKey(KEY, 4));
  });
});

describe("encrypt / decrypt", () => {
  it("rejects empty key and rounds < 1", () => {
    expect(() => encrypt("", 8, 1)).toThrow(/non-empty/);
    expect(() => decrypt(KEY, 0, 1)).toThrow(/rounds/);
  });

  it("round-trips edges 0 and 0xffffffff", () => {
    for (const plain of [0, 0xffffffff]) {
      const cipher = encrypt(KEY, RECOMMENDED_ROUNDS, plain);
      expect(cipher).toBe(cipher >>> 0);
      expect(decrypt(KEY, RECOMMENDED_ROUNDS, cipher)).toBe(plain >>> 0);
    }
  });

  it("treats wrap inputs as u32 via >>> 0", () => {
    // -1 and 0xffffffff are the same u32; 2**32 wraps to 0.
    expect(encrypt(KEY, 8, -1)).toBe(encrypt(KEY, 8, 0xffffffff));
    expect(encrypt(KEY, 8, 2 ** 32)).toBe(encrypt(KEY, 8, 0));
    expect(decrypt(KEY, 8, encrypt(KEY, 8, -1))).toBe(0xffffffff);
  });

  it("is deterministic for the same (key, rounds)", () => {
    const a = encrypt(KEY, 8, 42);
    const b = encrypt(KEY, 8, 42);
    expect(a).toBe(b);
    expect(decrypt(KEY, 8, a)).toBe(42);
  });

  it("is key-sensitive", () => {
    const plain = 0x12345678;
    const c1 = encrypt(KEY, 8, plain);
    const c2 = encrypt(OTHER_KEY, 8, plain);
    expect(c1).not.toBe(c2);
    expect(decrypt(OTHER_KEY, 8, c1)).not.toBe(plain);
    expect(decrypt(KEY, 8, c1)).toBe(plain);
  });

  it("round-trips a sample set (invertibility, not full 2^32)", () => {
    const samples = [
      0,
      1,
      0xffff,
      0x10000,
      0x80000000,
      0xffffffff,
      0x12345678,
      0xdeadbeef,
      0xcafebabe,
      42,
      0x7fffffff,
    ];
    // Spread a few more across the space without scanning all u32s.
    for (let i = 0; i < 64; i += 1) {
      samples.push((Math.imul(i, 0x9e3779b1) >>> 0) ^ 0xa5a5a5a5);
    }

    const seen = new Set<number>();
    for (const plain of samples) {
      const p = plain >>> 0;
      const cipher = encrypt(KEY, RECOMMENDED_ROUNDS, p);
      expect(decrypt(KEY, RECOMMENDED_ROUNDS, cipher)).toBe(p);
      seen.add(cipher);
    }
    expect(seen.size).toBe(new Set(samples.map((s) => s >>> 0)).size);
  });

  it("accepts Uint8Array keys", () => {
    const keyBytes = new TextEncoder().encode("byte-key");
    const plain = 99;
    const cipher = encrypt(keyBytes, 4, plain);
    expect(decrypt(keyBytes, 4, cipher)).toBe(plain);
  });
});
