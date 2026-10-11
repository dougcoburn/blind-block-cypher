import { describe, expect, it } from "vitest";

import { createCipher } from "./cipher";
import { decodeBase64url, encodeBase64url } from "./encoding";
import { createIdGenerator } from "./generator";
import { createPlainIdGenerator, packId, unpackId } from "./plainGenerator";

// Golden vectors from the PUBLISHED npm package blind-block-cypher@0.1.0,
// installed in a temp dir outside the repo (not a dependency). For each case:
//   id           = createIdGenerator(KEY, opts).generate()          (0.1.0)
//   plaintextHex = createFeistel96(KEY).decrypt(base64url(id))      (0.1.0)
// 0.1.0's plaintext layout is the same `seconds:33 | generatorId:10 |
// sequence:53` as 0.2.0, so compat holds at the cipher+encoding level AND
// at the generator level. Fake fixture key: never reuse it.
const KEY = "compat-fixture-key-FAKE-not-for-production";
/* cspell:disable -- base64url golden IDs */
const V010 = [
  {
    generatorId: 0,
    id: "64MsCkbpOWgFQgvm",
    nowMs: Date.UTC(2026, 0, 1),
    plaintextHex: "000000000000000000000000",
    seconds: 0,
    sequence: 0,
    sequenceStart: 0,
  },
  {
    generatorId: 7,
    id: "EKjWwRPE-3eTZL6r",
    nowMs: Date.UTC(2026, 9, 11, 22, 51, 3),
    plaintextHex: "00bb2ceb80e123456789abcd",
    rng: [0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd],
    seconds: 24533463,
    sequence: 320255973501901,
  },
  {
    generatorId: 1023,
    id: "eN-JWHAP9jGsYK_4",
    nowMs: Date.UTC(2026, 0, 1) + (2 ** 33 - 1) * 1000,
    plaintextHex: "ffffffffffffffffffffffff",
    seconds: 2 ** 33 - 1,
    sequence: 2 ** 53 - 1,
    sequenceStart: 2 ** 53 - 1,
  },
  {
    generatorId: 512,
    id: "c8UybDCSivdnjd6C",
    nowMs: Date.UTC(2030, 5, 15, 12),
    plaintextHex: "043027e0401fffffffffffff",
    rng: [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
    seconds: 140529600,
    sequence: 2 ** 53 - 1,
  },
];
/* cspell:enable */

function opts(v: (typeof V010)[number]) {
  return {
    generatorId: v.generatorId,
    now: () => v.nowMs,
    ...(v.rng
      ? { randomBytes: () => new Uint8Array(v.rng) }
      : { sequenceStart: v.sequenceStart }),
  };
}

describe("0.1.0 compatibility (published npm vectors)", () => {
  const cipher = createCipher(KEY);

  for (const v of V010) {
    it(`gid ${v.generatorId}: 0.1.0 ID -> decrypt96 -> 0.1.0 plaintext`, () => {
      const plain = cipher.decrypt96(decodeBase64url(v.id, 96));
      expect(plain.toString(16).padStart(24, "0")).toBe(v.plaintextHex);
      expect(unpackId(plain)).toStrictEqual({
        generatorId: v.generatorId,
        seconds: v.seconds,
        sequence: v.sequence,
      });
    });

    it(`gid ${v.generatorId}: 0.1.0 plaintext -> encrypt96 -> 0.1.0 ID`, () => {
      const plain = BigInt(`0x${v.plaintextHex}`);
      expect(encodeBase64url(cipher.encrypt96(plain), 96)).toBe(v.id);
      expect(packId(v)).toBe(plain);
    });

    it(`gid ${v.generatorId}: 0.2.0 wrapper mints and decodes the 0.1.0 ID`, () => {
      const g = createIdGenerator(KEY, opts(v));
      expect(g.generate()).toBe(v.id);
      expect(g.decode(v.id)).toStrictEqual({
        date: new Date(v.nowMs - (v.nowMs % 1000)),
        generatorId: v.generatorId,
        seconds: v.seconds,
        sequence: v.sequence,
      });
    });
  }
});

describe("keyed wrapper = manual composition of the layers", () => {
  it("matches encodeBase64url(encrypt96(plain.next()), 96) step for step", () => {
    let t = Date.UTC(2026, 3, 1, 8, 30);
    const rng = () => new Uint8Array([9, 8, 7, 6, 5, 4, 3]);
    const o = { generatorId: 42, now: () => t, randomBytes: rng };
    const g = createIdGenerator(KEY, o);
    const plain = createPlainIdGenerator(o);
    const cipher = createCipher(KEY);
    for (let i = 0; i < 50; i += 1) {
      if (i === 20) {
        t -= 5000; // step back: both pin
      }

      if (i === 35) {
        t += 60_000;
      }

      const id = g.generate();
      const expected = plain.next();
      expect(id).toBe(encodeBase64url(cipher.encrypt96(expected), 96));
      const d = g.decode(id);
      expect(packId(d)).toBe(expected);
      expect(d.date.getTime()).toBe(plain.epochMs + d.seconds * 1000);
      expect(g.decodeTime(id)).toStrictEqual(d.date);
    }
  });

  it("uses a different permutation for a different key", () => {
    const o = { now: () => Date.UTC(2026, 0, 2), sequenceStart: 1 };
    expect(createIdGenerator(KEY, o).generate()).not.toBe(
      createIdGenerator(`${KEY}-other`, o).generate()
    );
  });
});
