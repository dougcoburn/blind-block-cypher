import { describe, expect, it } from "vitest";

import {
  ID96_INFO,
  ID96_ROUNDS,
  createFeistel96,
  decryptBlock,
  encryptBlock,
} from "./feistel96";

const KEY = "feistel96-test-key-not-for-production";

function block(...bytes: number[]): Uint8Array {
  const out = new Uint8Array(12);
  out.set(bytes);
  return out;
}

describe("createFeistel96", () => {
  it("uses fixed 20 rounds and the id96 info string", () => {
    expect(ID96_ROUNDS).toBe(20);
    expect(ID96_INFO).toBe("blind-block-cypher/id96/v1");
  });

  it("throws on an empty key", () => {
    expect(() => createFeistel96("")).toThrow(/non-empty/);
    expect(() => createFeistel96(new Uint8Array(0))).toThrow(/non-empty/);
  });

  it("round-trips edge and pseudo-random blocks", () => {
    const f = createFeistel96(KEY);
    const samples = [block(), new Uint8Array(12).fill(0xff), block(1)];
    let x = 0x12345678;
    for (let i = 0; i < 200; i += 1) {
      const b = new Uint8Array(12);
      for (let j = 0; j < 12; j += 1) {
        x = (Math.imul(x, 1103515245) + 12345) >>> 0;
        b[j] = x >>> 24;
      }

      samples.push(b);
    }

    for (const plain of samples) {
      const cipher = f.encrypt(plain);
      expect(cipher).toHaveLength(12);
      expect(cipher).not.toStrictEqual(plain);
      expect(f.decrypt(cipher)).toStrictEqual(plain);
    }
  });

  it("does not mutate its input and accepts offset views", () => {
    const f = createFeistel96(KEY);
    const backing = new Uint8Array(20).fill(7);
    const view = backing.subarray(4, 16);
    const before = backing.slice();
    const cipher = f.encrypt(view);
    expect(backing).toStrictEqual(before);
    expect(cipher).toStrictEqual(f.encrypt(view.slice()));
    expect(f.decrypt(cipher)).toStrictEqual(view.slice());
  });

  it("rejects blocks that are not 12 bytes", () => {
    const f = createFeistel96(KEY);
    expect(() => f.encrypt(new Uint8Array(11))).toThrow(RangeError);
    expect(() => f.decrypt(new Uint8Array(13))).toThrow(RangeError);
    expect(() => f.encrypt(Array(12).fill(0) as unknown as Uint8Array)).toThrow(
      RangeError
    );
  });

  it("gives unrelated output under different keys", () => {
    const a = createFeistel96(KEY).encrypt(block());
    const b = createFeistel96(`${KEY}!`).encrypt(block());
    expect(a).not.toStrictEqual(b);
  });

  it("has one-shot helpers that match", () => {
    const plain = block(9, 8, 7);
    const cipher = encryptBlock(KEY, plain);
    expect(cipher).toStrictEqual(createFeistel96(KEY).encrypt(plain));
    expect(decryptBlock(KEY, cipher)).toStrictEqual(plain);
  });
});
