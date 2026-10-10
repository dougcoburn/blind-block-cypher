// Independent reference for id96 golden vectors. Shares no code with src/:
// BigInt arithmetic throughout, its own round count, its own packing.
// Usage: node scripts/id96-reference.mjs
import { createHmac, hkdfSync } from "node:crypto";

const ROUNDS = 20; // own constant; must match the id96 format, not src/
const INFO = "blind-block-cypher/id96/v1";
const HALF = 48n;
const MASK = (1n << HALF) - 1n;
const EPOCH_MS = Date.UTC(2026, 0, 1);

function be(bytes) {
  let v = 0n;
  for (const b of bytes) {
    v = (v << 8n) | BigInt(b);
  }

  return v;
}

function toBytes(v, n) {
  const out = Buffer.alloc(n);
  for (let i = n - 1; i >= 0; i -= 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }

  return out;
}

function roundKeys(key, rounds) {
  const keys = [];
  for (let i = 0; i < rounds; i += 1) {
    const okm = Buffer.from(
      hkdfSync(
        "sha256",
        Buffer.from(key, "utf8"),
        Buffer.alloc(0),
        Buffer.concat([Buffer.from(INFO, "utf8"), Buffer.from([i])]),
        44
      )
    );
    keys.push({
      a: be(okm.subarray(38, 44)) & MASK,
      hmacKey: okm.subarray(0, 32),
      m: (be(okm.subarray(32, 38)) & MASK) | 1n,
    });
  }

  return keys;
}

function F(r, k) {
  const mixed = (r * k.m + k.a) & MASK;
  const mac = createHmac("sha256", k.hmacKey)
    .update(toBytes(mixed, 6))
    .digest();
  return be(mac.subarray(0, 6));
}

function encrypt(key, block96, rounds) {
  let L = block96 >> HALF;
  let R = block96 & MASK;
  for (const k of roundKeys(key, rounds)) {
    [L, R] = [R, L ^ F(R, k)];
  }

  return (L << HALF) | R;
}

function vector(key, nowMs, generatorId, rng, count) {
  const seconds = BigInt(Math.floor((nowMs - EPOCH_MS) / 1000));
  let sequence = be(rng) & ((1n << 53n) - 1n);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const plain = (seconds << 63n) | (BigInt(generatorId) << 53n) | sequence;
    const cipher = encrypt(key, plain, ROUNDS);
    out.push({
      generatorId,
      id: toBytes(cipher, 12).toString("base64url"),
      nowMs,
      plaintextHex: toBytes(plain, 12).toString("hex"),
      rngHex: Buffer.from(rng).toString("hex"),
      seconds: Number(seconds),
      sequence: Number(sequence),
    });
    sequence = (sequence + 1n) & ((1n << 53n) - 1n);
  }

  return out;
}

const KEY = "golden-vector-key-not-for-production";
const vectors = [
  ...vector(
    KEY,
    EPOCH_MS + 12_345_678_900,
    0,
    [0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd],
    2
  ),
  ...vector(
    KEY,
    EPOCH_MS + (2 ** 33 - 1) * 1000 + 500,
    1023,
    [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
    2
  ),
];

console.log(
  JSON.stringify(
    { epochMs: EPOCH_MS, key: KEY, rounds: ROUNDS, vectors },
    null,
    2
  )
);
