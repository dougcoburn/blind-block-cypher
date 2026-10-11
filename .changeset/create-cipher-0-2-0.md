---
"blind-block-cypher": minor
---

**BREAKING:** new `createCipher(key)` API; old low-level exports removed.

- **New:** `createCipher(key)` returns `encrypt32`/`decrypt32` (number), and `encrypt64`/`decrypt64`, `encrypt96`/`decrypt96`, `encrypt128`/`decrypt128` (bigint). Every width is a fixed 20-round HMAC-SHA256 + mulmix Feistel with its own HKDF info string (`blind-block-cypher/u32/v2`, `u64/v1`, `id96/v1`, `u128/v1`). Also exports `CIPHER_ROUNDS` (20) and the `Cipher` type.
- **u32 changed:** 32-bit encryption is now u32 v2 (new round function, new key derivation, 20 rounds instead of 8). **Every u32 ciphertext from 0.1.0 changes.** Decrypt or re-map stored values with 0.1.0 before upgrading.
- **Strict validation:** inputs are no longer wrapped with `>>> 0`. `encrypt32`/`decrypt32` require an integer `number` in `[0, 2^32)`; the bigint methods require a `bigint` in `[0, 2^width)`. Wrong type throws `TypeError`; non-integer or out-of-range throws `RangeError`.
- **Removed exports:** `encrypt(key, rounds, x)`, `decrypt(key, rounds, x)`, `expandKey`, `RoundMaterial`, `RECOMMENDED_ROUNDS`, `permutation`, `deriveRoundKeys`, `RoundKey`, `createFeistel96`, `Feistel96`, `encryptBlock`, `decryptBlock`.
- **Unchanged:** `createIdGenerator` and id96 IDs. `encrypt96` is byte-identical to 0.1.0's `encryptBlock`, so existing id96 IDs still decode.
