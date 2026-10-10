import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_EPOCH_MS,
  type IdGeneratorOptions,
  InvalidIdError,
  SEQ_MOD,
  createIdGenerator,
  createIdGeneratorWithModulus,
  nextSequence,
} from "./generator";

const KEY = "generator-test-key-not-for-production";
const T0 = DEFAULT_EPOCH_MS + 1_000_000_000; // second 1,000,000

function clock(startMs = T0) {
  const c = { ms: startMs, now: () => c.ms };
  return c;
}

function fixedRng(bytes: number[]) {
  return vi.fn((n: number) => {
    expect(n).toBe(7);
    return new Uint8Array(bytes);
  });
}

function make(opts: IdGeneratorOptions = {}) {
  return createIdGenerator(KEY, { now: () => T0, sequenceStart: 0, ...opts });
}

describe("nextSequence", () => {
  it("adds one", () => {
    expect(nextSequence(0, 0 + 5)).toBe(1);
    expect(nextSequence(41, 0)).toBe(42);
  });

  it("wraps 2^53 - 1 to 0", () => {
    expect(SEQ_MOD).toBe(2 ** 53);
    expect(nextSequence(2 ** 53 - 1, 5)).toBe(0);
  });

  it("throws when the next value would be the start", () => {
    expect(() => nextSequence(4, 5)).toThrow(/sequence exhausted/);
    expect(() => nextSequence(4, 5)).toThrow(RangeError);
    expect(() => nextSequence(2 ** 53 - 1, 0)).toThrow(/sequence exhausted/);
    expect(() => nextSequence(7, 0, 8)).toThrow(/sequence exhausted/);
  });
});

describe("createIdGenerator: construction", () => {
  it("throws on an empty key", () => {
    expect(() => createIdGenerator("")).toThrow(/non-empty/);
  });

  it("checks generatorId bounds", () => {
    for (const generatorId of [-1, 1024, 1.5, Number.NaN]) {
      expect(() => make({ generatorId })).toThrow(RangeError);
    }

    expect(() => make({ generatorId: "1" as unknown as number })).toThrow(
      RangeError
    );
    expect(make({ generatorId: 0 }).decode(make().generate()).generatorId).toBe(
      0
    );
    const g1023 = make({ generatorId: 1023 });
    expect(g1023.decode(g1023.generate()).generatorId).toBe(1023);
  });

  it("checks sequenceStart bounds", () => {
    for (const sequenceStart of [-1, 2 ** 53, 1.5, Number.NaN]) {
      expect(() => make({ sequenceStart })).toThrow(RangeError);
    }

    const lo = make({ sequenceStart: 0 });
    expect(lo.decode(lo.generate()).sequence).toBe(0);
    const hi = make({ sequenceStart: 2 ** 53 - 1 });
    expect(hi.decode(hi.generate()).sequence).toBe(2 ** 53 - 1);
    expect(hi.decode(hi.generate()).sequence).toBe(0);
  });

  it("checks the epoch", () => {
    expect(() => make({ epoch: DEFAULT_EPOCH_MS + 1 })).toThrow(RangeError);
    expect(() => make({ epoch: new Date(Number.NaN) })).toThrow(RangeError);
    expect(() => make({ epoch: Number.POSITIVE_INFINITY })).toThrow(RangeError);
  });

  it("checks maxFutureSkewSeconds", () => {
    for (const maxFutureSkewSeconds of [-1, Number.NaN]) {
      expect(() => make({ maxFutureSkewSeconds })).toThrow(RangeError);
    }

    expect(() =>
      make({ maxFutureSkewSeconds: "60" as unknown as number })
    ).toThrow(RangeError);
    expect(() => make({ maxFutureSkewSeconds: 0 })).not.toThrow();
  });

  it("checks the test modulus", () => {
    for (const m of [0, 1.5, 2 ** 53 + 2]) {
      expect(() => createIdGeneratorWithModulus(KEY, m)).toThrow(RangeError);
    }
  });
});

describe("createIdGenerator: defaults", () => {
  it("works with no options", () => {
    const before = Date.now();
    const g = createIdGenerator(KEY);
    const id = g.generate();
    expect(id).toMatch(/^[A-Za-z0-9_-]{16}$/);
    const decoded = g.decode(id);
    expect(decoded.generatorId).toBe(0);
    expect(decoded.date.getTime()).toBe(
      DEFAULT_EPOCH_MS + decoded.seconds * 1000
    );
    expect(Math.abs(g.decodeTime(id).getTime() - before)).toBeLessThan(5000);
    expect(Number.isSafeInteger(decoded.sequence)).toBe(true);
  });

  it("takes the default sequenceStart from the injected RNG", () => {
    const rng = fixedRng([0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd]);
    const g = createIdGenerator(KEY, { now: () => T0, randomBytes: rng });
    expect(rng).toHaveBeenCalledTimes(1);
    expect(g.decode(g.generate()).sequence).toBe(0x0123456789abcd);

    // 56 bits masked to 53.
    const ones = createIdGenerator(KEY, {
      now: () => T0,
      randomBytes: fixedRng(Array<number>(7).fill(0xff)),
    });
    expect(ones.decode(ones.generate()).sequence).toBe(2 ** 53 - 1);
  });

  it("does not call the RNG when sequenceStart is explicit", () => {
    const rng = fixedRng(Array<number>(7).fill(0));
    make({ randomBytes: rng, sequenceStart: 9 });
    expect(rng).not.toHaveBeenCalled();
  });
});

describe("createIdGenerator: sequence", () => {
  it("honors an explicit sequenceStart and adds 1 per ID", () => {
    const g = make({ sequenceStart: 1000 });
    for (let i = 0; i < 50; i += 1) {
      expect(g.decode(g.generate()).sequence).toBe(1000 + i);
    }
  });

  it("does not reset when the second changes", () => {
    const c = clock();
    const g = make({ now: c.now, sequenceStart: 7 });
    expect(g.decode(g.generate())).toMatchObject({ seconds: 1e6, sequence: 7 });
    c.ms += 3000;
    expect(g.decode(g.generate())).toMatchObject({
      seconds: 1e6 + 3,
      sequence: 8,
    });
  });

  it("mints every value of a mod-8 generator from start 5, then throws", () => {
    const g = createIdGeneratorWithModulus(KEY, 8, {
      now: () => T0,
      sequenceStart: 5,
    });
    const seen = [];
    for (let i = 0; i < 8; i += 1) {
      seen.push(g.decode(g.generate()).sequence);
    }

    expect(seen).toStrictEqual([5, 6, 7, 0, 1, 2, 3, 4]);
    expect(() => g.generate()).toThrow(/sequence exhausted/);
    expect(() => g.generate()).toThrow(RangeError);
  });

  it("checks sequenceStart against the test modulus and reduces RNG starts", () => {
    expect(() =>
      createIdGeneratorWithModulus(KEY, 8, { sequenceStart: 8 })
    ).toThrow(RangeError);
    const g = createIdGeneratorWithModulus(KEY, 8, {
      now: () => T0,
      randomBytes: fixedRng([0, 0, 0, 0, 0, 0, 13]),
    });
    expect(g.decode(g.generate()).sequence).toBe(5);
  });

  it("gives the SAME ID for same key + generatorId + sequenceStart + second", () => {
    const a = make({ generatorId: 3, sequenceStart: 77 });
    const b = make({ generatorId: 3, sequenceStart: 77 });
    expect(a.generate()).toBe(b.generate());
  });

  it("separates generators by generatorId", () => {
    const ids = new Set<string>();
    for (let gid = 0; gid < 1024; gid += 31) {
      const g = make({ generatorId: gid, sequenceStart: 77 });
      const id = g.generate();
      ids.add(id);
      expect(g.decode(id)).toMatchObject({ generatorId: gid, sequence: 77 });
    }

    expect(ids.size).toBe(Math.ceil(1024 / 31));
  });
});

describe("createIdGenerator: clock", () => {
  it("does not throw on an equal second", () => {
    const c = clock(T0);
    const g = make({ now: c.now });
    g.generate();
    c.ms = T0 + 999;
    expect(g.decode(g.generate()).seconds).toBe(1e6);
  });

  it("pins to the last minted second when the clock steps back 5s", () => {
    const c = clock(T0);
    const g = make({ now: c.now, sequenceStart: 100 });
    g.generate();
    c.ms = T0 - 5000;
    const ids = new Set<string>();
    for (let i = 0; i < 300; i += 1) {
      const id = g.generate();
      ids.add(id);
      expect(g.decode(id)).toMatchObject({ seconds: 1e6, sequence: 101 + i });
    }

    expect(ids.size).toBe(300);
  });

  it("follows the real clock again once it passes the pinned second", () => {
    const c = clock(T0);
    const g = make({ now: c.now });
    g.generate();
    c.ms = T0 - 5000;
    expect(g.decode(g.generate()).seconds).toBe(1e6);
    c.ms = T0 + 500; // still the pinned second
    expect(g.decode(g.generate()).seconds).toBe(1e6);
    c.ms = T0 + 1000;
    expect(g.decode(g.generate()).seconds).toBe(1e6 + 1);
    c.ms = T0 + 10_000;
    expect(g.decodeTime(g.generate()).getTime()).toBe(T0 + 10_000);
  });

  it("throws RangeError before the epoch on a fresh generator", () => {
    const g = make({ now: () => DEFAULT_EPOCH_MS - 1 });
    expect(() => g.generate()).toThrow(/before the epoch/);
    expect(() => g.generate()).toThrow(RangeError);
  });

  it("pins instead of throwing if a used generator's clock falls before the epoch", () => {
    const c = clock(DEFAULT_EPOCH_MS + 5000);
    const g = make({ now: c.now });
    g.generate();
    c.ms = DEFAULT_EPOCH_MS - 60_000;
    expect(g.decode(g.generate()).seconds).toBe(5);
  });

  it("accepts the last second and throws RangeError at 33-bit rollover", () => {
    const last = make({ now: () => DEFAULT_EPOCH_MS + (2 ** 33 - 1) * 1000 });
    expect(last.decode(last.generate()).seconds).toBe(2 ** 33 - 1);
    const g = make({ now: () => DEFAULT_EPOCH_MS + 2 ** 33 * 1000 });
    expect(() => g.generate()).toThrow(/rollover/);
    expect(() => g.generate()).toThrow(RangeError);
  });

  it("uses a custom epoch (Date or ms)", () => {
    const epoch = Date.UTC(2030, 5, 1);
    const asDate = make({ epoch: new Date(epoch), now: () => epoch + 42_000 });
    const asMs = make({ epoch, now: () => epoch + 42_000 });
    const id = asDate.generate();
    expect(id).toBe(asMs.generate());
    expect(asDate.decode(id)).toMatchObject({
      date: new Date(epoch + 42_000),
      seconds: 42,
    });
  });
});

describe("createIdGenerator: decode", () => {
  it("rejects malformed IDs with InvalidIdError", () => {
    const g = make();
    expect(() => g.decode("short")).toThrow(InvalidIdError);
    expect(() => g.decode(`${g.generate()}A`)).toThrow(InvalidIdError);
    expect(() => g.decodeTime("AAAAAAAAAAAAAAA+")).toThrow(InvalidIdError);
  });

  it("decodes any well-formed string (no MAC)", () => {
    const d = make().decode("AAAAAAAAAAAAAAAA");
    expect(Number.isSafeInteger(d.sequence)).toBe(true);
    expect(d.generatorId).toBeLessThan(1024);
  });

  it("strictTime rejects a pinned ID when the clock is back by more than the skew", () => {
    const c = clock(T0);
    const g = make({ now: c.now });
    g.generate();
    c.ms = T0 - 61_000; // stepped back more than the default 60s skew
    const pinned = g.generate();
    expect(g.decode(pinned).seconds).toBe(1e6);
    expect(() => g.decode(pinned, { strictTime: true })).toThrow(
      InvalidIdError
    );

    const relaxed = make({ maxFutureSkewSeconds: 120, now: c.now });
    expect(relaxed.decode(pinned, { strictTime: true }).seconds).toBe(1e6);
  });

  it("strictTime can be the generator default and overridden per call", () => {
    const c = clock(T0);
    const minted = make({ now: c.now }).generate();
    c.ms = T0 - 61_000;
    const g = make({ now: c.now, strictTime: true });
    expect(() => g.decode(minted)).toThrow(InvalidIdError);
    expect(() => g.decodeTime(minted)).toThrow(InvalidIdError);
    expect(g.decode(minted, { strictTime: false }).seconds).toBe(1e6);
    c.ms = T0 - 60_000; // exactly at the skew boundary is allowed
    expect(g.decode(minted).seconds).toBe(1e6);
  });

  it("decodes a fresh ID under strictTime", () => {
    const g = make({ strictTime: true });
    expect(g.decode(g.generate()).seconds).toBe(1e6);
  });
});
