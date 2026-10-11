import { describe, expect, it } from "vitest";

import {
  DEFAULT_EPOCH_MS,
  SECONDS_MOD,
  SEQUENCE_MOD,
  createPlainIdGenerator,
  packId,
  unpackId,
} from "./plainGenerator";

const one = BigInt(1);
const fixedClock = (ms: number) => () => ms;

describe("packId / unpackId", () => {
  it("places seconds:33 | generatorId:10 | sequence:53 big-endian", () => {
    expect(packId({ generatorId: 0, seconds: 0, sequence: 1 })).toBe(one);
    expect(packId({ generatorId: 1, seconds: 0, sequence: 0 })).toBe(
      one << BigInt(53)
    );
    expect(packId({ generatorId: 0, seconds: 1, sequence: 0 })).toBe(
      one << BigInt(63)
    );
    const max = {
      generatorId: 1023,
      seconds: SECONDS_MOD - 1,
      sequence: SEQUENCE_MOD - 1,
    };
    expect(packId(max)).toBe((one << BigInt(96)) - one);
    expect(unpackId((one << BigInt(96)) - one)).toStrictEqual(max);
    const f = { generatorId: 517, seconds: 123_456_789, sequence: 2 ** 52 + 7 };
    expect(unpackId(packId(f))).toStrictEqual(f);
  });

  it("rejects out-of-range fields", () => {
    const ok = { generatorId: 0, seconds: 0, sequence: 0 };
    for (const bad of [
      { seconds: -1 },
      { seconds: SECONDS_MOD },
      { seconds: 1.5 },
      { generatorId: 1024 },
      { generatorId: -1 },
      { sequence: SEQUENCE_MOD },
      { sequence: -1 },
    ]) {
      expect(() => packId({ ...ok, ...bad })).toThrow(RangeError);
    }
  });

  it("rejects ids outside [0, 2^96)", () => {
    expect(() => unpackId(-one)).toThrow(RangeError);
    expect(() => unpackId(one << BigInt(96))).toThrow(RangeError);
    expect(() => unpackId(1 as unknown as bigint)).toThrow(RangeError);
  });
});

describe("createPlainIdGenerator", () => {
  it("mints seconds since the default epoch with +1 sequence", () => {
    const g = createPlainIdGenerator({
      generatorId: 9,
      now: fixedClock(DEFAULT_EPOCH_MS + 42_999),
      sequenceStart: 100,
    });
    expect(g.epochMs).toBe(Date.UTC(2026, 0, 1));
    expect(g.generatorId).toBe(9);
    expect(unpackId(g.next())).toStrictEqual({
      generatorId: 9,
      seconds: 42,
      sequence: 100,
    });
    expect(unpackId(g.next()).sequence).toBe(101);
  });

  it("accepts a Date or ms epoch and uses Date.now by default", () => {
    const g = createPlainIdGenerator({ epoch: new Date(0), sequenceStart: 0 });
    const s = unpackId(g.next()).seconds;
    expect(Math.abs(s - Math.floor(Date.now() / 1000))).toBeLessThanOrEqual(1);
    const h = createPlainIdGenerator({
      epoch: 5000,
      now: fixedClock(8000),
      sequenceStart: 0,
    });
    expect(unpackId(h.next()).seconds).toBe(3);
  });

  it("draws a 53-bit random start from the injected source", () => {
    const g = createPlainIdGenerator({
      now: fixedClock(DEFAULT_EPOCH_MS),
      randomBytes: (n) => new Uint8Array(n).fill(0xff),
    });
    expect(unpackId(g.next()).sequence).toBe(SEQUENCE_MOD - 1);
    const h = createPlainIdGenerator({
      now: fixedClock(DEFAULT_EPOCH_MS),
      randomBytes: () => new Uint8Array([0xe0, 0, 0, 0, 0, 0, 1]),
    });
    expect(unpackId(h.next()).sequence).toBe(1);
    const d = createPlainIdGenerator();
    expect(d.generatorId).toBe(0);
    expect(unpackId(d.next()).sequence).toBeLessThan(SEQUENCE_MOD);
    expect(() =>
      createPlainIdGenerator({ randomBytes: () => new Uint8Array(6) })
    ).toThrow(RangeError);
  });

  it("wraps the sequence 2^53-1 -> 0 without throwing", () => {
    const g = createPlainIdGenerator({
      now: fixedClock(DEFAULT_EPOCH_MS),
      sequenceStart: SEQUENCE_MOD - 1,
    });
    expect(unpackId(g.next()).sequence).toBe(SEQUENCE_MOD - 1);
    expect(unpackId(g.next()).sequence).toBe(0);
    expect(unpackId(g.next()).sequence).toBe(1);
  });

  it("pins seconds when the clock steps back, keeping the sequence +1", () => {
    let t = DEFAULT_EPOCH_MS + 100_000;
    const g = createPlainIdGenerator({ now: () => t, sequenceStart: 0 });
    expect(unpackId(g.next()).seconds).toBe(100);
    t -= 5000;
    const seen = new Set<bigint>();
    for (let i = 1; i <= 300; i += 1) {
      const id = g.next();
      seen.add(id);
      expect(unpackId(id)).toMatchObject({ seconds: 100, sequence: i });
    }

    expect(seen.size).toBe(300);
    t = DEFAULT_EPOCH_MS + 101_000;
    expect(unpackId(g.next()).seconds).toBe(101);
  });

  it("clamps before the epoch range check", () => {
    let t = DEFAULT_EPOCH_MS;
    const g = createPlainIdGenerator({ now: () => t, sequenceStart: 0 });
    g.next();
    t = DEFAULT_EPOCH_MS - 10_000;
    expect(unpackId(g.next()).seconds).toBe(0);
  });

  it("throws distinct errors before the epoch and past rollover", () => {
    const early = createPlainIdGenerator({
      now: fixedClock(DEFAULT_EPOCH_MS - 1),
      sequenceStart: 0,
    });
    expect(() => early.next()).toThrow(/before the epoch/);
    const nan = createPlainIdGenerator({
      now: fixedClock(Number.NaN),
      sequenceStart: 0,
    });
    expect(() => nan.next()).toThrow(RangeError);
    const last = createPlainIdGenerator({
      now: fixedClock(DEFAULT_EPOCH_MS + (SECONDS_MOD - 1) * 1000),
      sequenceStart: 0,
    });
    expect(unpackId(last.next()).seconds).toBe(SECONDS_MOD - 1);
    const late = createPlainIdGenerator({
      now: fixedClock(DEFAULT_EPOCH_MS + SECONDS_MOD * 1000),
      sequenceStart: 0,
    });
    expect(() => late.next()).toThrow(/rollover/);
  });

  it("validates options", () => {
    for (const generatorId of [-1, 1024, 1.5]) {
      expect(() => createPlainIdGenerator({ generatorId })).toThrow(RangeError);
    }

    for (const sequenceStart of [-1, SEQUENCE_MOD, 0.5]) {
      expect(() => createPlainIdGenerator({ sequenceStart })).toThrow(
        RangeError
      );
    }

    for (const epoch of [1500, Number.NaN, new Date(Number.NaN)]) {
      expect(() => createPlainIdGenerator({ epoch })).toThrow(RangeError);
    }
  });
});
