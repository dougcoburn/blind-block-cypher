---
"blind-block-cypher": minor
---

BREAKING: 0.2.0 restructures the package into three layers and tightens the public API.

- Split into separate cipher, encoding, and generator layers. The keyed `createIdGenerator` is rebuilt on top of them, and an unkeyed `createPlainIdGenerator` is added.
- New `createCipher(key)` with keyed Feistel permutations at four widths: `encrypt32` / `decrypt32` take and return a `number`; `encrypt64` / `decrypt64`, `encrypt96` / `decrypt96` and `encrypt128` / `decrypt128` take and return a `bigint`. Every width uses a fixed 20 rounds (`CIPHER_ROUNDS`). `encrypt96` is byte-identical to 0.1.0's `encryptBlock` on the same 12-byte big-endian block, so existing id96 IDs still decode.
- Removed exports: `encrypt`, `decrypt`, `expandKey`, `RoundMaterial`, `RECOMMENDED_ROUNDS`, `deriveRoundKeys`, `RoundKey`, `createFeistel96`, `Feistel96`, `encryptBlock`, `decryptBlock` and `ID96_ROUNDS`. Use the new width-specific cipher API instead.
- u32 cipher outputs change: the 32-bit cipher is now u32 v2 (HMAC-SHA256 round function, HKDF info `blind-block-cypher/u32/v2`) at a fixed 20 rounds instead of 8, so it is no longer affine/linear. Every u32 ciphertext changes vs 0.1.0: values encrypted with 0.1.x's `encrypt` will not decrypt to the same plaintext under 0.2.0.
- Strict input validation: out-of-range or non-integer inputs now throw instead of being silently wrapped (for example via `>>> 0`), and non-canonical encoded strings are rejected with `InvalidIdError`. Cipher inputs of the wrong type (`encrypt32` needs a `number`, the wider methods a `bigint`) throw `TypeError`; non-integer or out-of-range values throw `RangeError`. Keys follow the same rule in `createCipher` and `createIdGenerator`: a key that isn't a string or `Uint8Array` throws `TypeError`, and an empty key throws `RangeError`.
- Added an `exports` map with separate ESM (`.mjs` / `.d.mts`) and CommonJS (`.js` / `.d.ts`) entry points. Deep imports into `dist/` are no longer allowed.
- Added the MIT `LICENSE` file to the published package.
