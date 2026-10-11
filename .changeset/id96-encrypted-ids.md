---
"blind-block-cypher": minor
---

Add id96: opaque 16-char base64url IDs from a keyed 96-bit HMAC Feistel (20 rounds). The layout is seconds:33, generatorId:10 and sequence:53. `createIdGenerator` returns `generate`, `decode` and `decodeTime`.
