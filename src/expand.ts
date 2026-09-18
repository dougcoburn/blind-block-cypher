import { hkdfSync } from "node:crypto";

export interface RoundMaterial {
  /** 16-bit XOR mask for F. */
  mask: number;
  /** Id passed to permutation(16, id) for the bit shuffle. */
  shuffleId: number;
}

/**
 * Expand `key` into per-round material via HKDF-SHA256.
 * Each round gets a 16-bit mask (2 bytes) and a shuffle id (6 bytes, fits in
 * Number and covers 16! ≈ 2.09e13).
 */
export function expandKey(
  key: Uint8Array | string,
  rounds: number
): RoundMaterial[] {
  const ikm =
    typeof key === "string" ? Buffer.from(key, "utf8") : Buffer.from(key);
  if (ikm.length === 0) {
    throw new Error("key must be non-empty");
  }

  if (!Number.isInteger(rounds) || rounds < 1) {
    throw new Error("rounds must be an integer >= 1");
  }

  const bytesPerRound = 8; // 2 mask + 6 shuffleId
  const okm = Buffer.from(
    hkdfSync(
      "sha256",
      ikm,
      Buffer.alloc(0),
      "blind-block-cypher/v1",
      rounds * bytesPerRound
    )
  );

  const material: RoundMaterial[] = [];
  for (let r = 0; r < rounds; r += 1) {
    const o = r * bytesPerRound;
    const mask = okm.readUInt16BE(o);
    // 48-bit big-endian → Number (safe; 16! < 2^53)
    let shuffleId = 0;
    for (let i = 0; i < 6; i += 1) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- HKDF length
      shuffleId = shuffleId * 256 + okm[o + 2 + i]!;
    }

    material.push({ mask, shuffleId });
  }

  return material;
}
