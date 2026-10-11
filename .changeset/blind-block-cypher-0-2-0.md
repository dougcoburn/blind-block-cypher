---
"blind-block-cypher": minor
---

BREAKING: 0.2.0 restructures the package into three layers and tightens the public API.

- Split into separate cipher, encoding, and generator layers. The keyed `createIdGenerator` is rebuilt on top of them, and an unkeyed `createPlainIdGenerator` is added.
- Removed the old u32 `encrypt` / `decrypt` / `expandKey` exports and the raw Feistel exports. Use the new width-specific cipher API instead.
- u32 cipher outputs change: the round function is fixed so the 32-bit cipher is no longer affine/linear. Values encrypted with 0.1.x's `encrypt` will not decrypt to the same plaintext under 0.2.0.
- Strict input validation: out-of-range or non-integer inputs now throw instead of being silently wrapped (for example via `>>> 0`), and non-canonical encoded strings are rejected with `InvalidIdError`.
- Added an `exports` map with separate ESM (`.mjs` / `.d.mts`) and CommonJS (`.js` / `.d.ts`) entry points. Deep imports into `dist/` are no longer allowed. When both builds load in one process, `InvalidIdError` is not `instanceof` across them, so check `err.name`.
- Added the MIT `LICENSE` file to the published package.
