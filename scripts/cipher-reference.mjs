// Independent reference for createCipher golden vectors (32/64/96/128-bit).
// Shares no code with src/: BigInt throughout, its own round count.
// Usage: node scripts/cipher-reference.mjs
import { createHmac, hkdfSync } from "node:crypto";

const ROUNDS = 20; // own constant; must match the format, not src/
const INFO = {
  32: "blind-block-cypher/u32/v2",
  64: "blind-block-cypher/u64/v1",
  96: "blind-block-cypher/id96/v1",
  128: "blind-block-cypher/u128/v1",
};
const KEY = "cipher-golden-key-not-for-production";

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

function roundKeys(width) {
  const halfBytes = width / 16;
  const keys = [];
  for (let i = 0; i < ROUNDS; i += 1) {
    const okm = Buffer.from(
      hkdfSync(
        "sha256",
        Buffer.from(KEY, "utf8"),
        Buffer.alloc(0),
        Buffer.concat([Buffer.from(INFO[width], "utf8"), Buffer.from([i])]),
        32 + 2 * halfBytes
      )
    );
    keys.push({
      a: be(okm.subarray(32 + halfBytes, 32 + 2 * halfBytes)),
      hmacKey: okm.subarray(0, 32),
      m: be(okm.subarray(32, 32 + halfBytes)) | 1n,
    });
  }

  return keys;
}

function encrypt(width, x) {
  const half = BigInt(width / 2);
  const halfBytes = width / 16;
  const mask = (1n << half) - 1n;
  let L = x >> half;
  let R = x & mask;
  for (const k of roundKeys(width)) {
    const mixed = (R * k.m + k.a) & mask;
    const mac = createHmac("sha256", k.hmacKey)
      .update(toBytes(mixed, halfBytes))
      .digest();
    [L, R] = [R, L ^ be(mac.subarray(0, halfBytes))];
  }

  return (L << half) | R;
}

const MID = {
  32: 0x12345678n,
  64: 0x0123456789abcdefn,
  96: 0x0123456789abcdeffedcba98n,
  128: 0x0123456789abcdeffedcba9876543210n,
};

const vectors = {};
for (const width of [32, 64, 96, 128]) {
  const max = (1n << BigInt(width)) - 1n;
  vectors[width] = [0n, 1n, MID[width], max].map((x) => ({
    cipher: `0x${encrypt(width, x).toString(16)}`,
    plain: `0x${x.toString(16)}`,
  }));
}

console.log(JSON.stringify({ key: KEY, rounds: ROUNDS, vectors }, null, 2));
