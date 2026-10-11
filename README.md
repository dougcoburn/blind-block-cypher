# blind-block-cypher

Keyed, format-preserving block ciphers for ID obfuscation, plus the pieces to mint opaque, URL-safe IDs that hide when they were created.

0.2.0 splits the library into three independent layers:

| Layer     | Keyed? | What it does                                                                   |
| --------- | ------ | ------------------------------------------------------------------------------ |
| Cipher    | Yes    | `createCipher(key)`: bijections on 32, 64, 96 and 128-bit unsigned integers.   |
| Encoding  | No     | `encodeBase64url` / `decodeBase64url`: fixed-length, strict base64url strings. |
| Generator | No     | `createPlainIdGenerator()`: 96-bit plaintext IDs (time, generator, sequence).  |

An opaque ID is exactly `urlencode(encrypt(generate()))`. `createIdGenerator(key)` does that for you and is unchanged from 0.1.0.

**Scope:** this is ID obfuscation, so sequential or time-based identifiers don't show on the wire. It is **not** a general-purpose cipher. Don't use it for message confidentiality, authenticated encryption, passwords, or anything that must hold up against a serious adversary.

## Install

```bash
pnpm add blind-block-cypher
```

Node only (it uses `node:crypto`). Ships ESM and CommonJS builds with types for each. MIT licensed.

## Quick start

```ts
import { createIdGenerator } from "blind-block-cypher";

const ids = createIdGenerator(process.env.ID_KEY ?? "");

const id = ids.generate(); // 16-char base64url string, e.g. "q3Zt-0VbN_x8Lk2A"
ids.decodeTime(id); // Date the ID was minted (to the second)
ids.decode(id); // { date, generatorId, seconds, sequence }
```

## Cipher layer

```ts
import { createCipher } from "blind-block-cypher";

const cipher = createCipher(process.env.CIPHER_KEY ?? "");

cipher.encrypt32(42); // number in [0, 2^32)
cipher.decrypt32(cipher.encrypt32(42)); // 42

cipher.encrypt64(12345n); // bigint in [0, 2^64)
cipher.encrypt96(12345n); // bigint in [0, 2^96)
cipher.encrypt128(12345n); // bigint in [0, 2^128)
```

| Method                      | Input / output                   |
| --------------------------- | -------------------------------- |
| `encrypt32` / `decrypt32`   | `number`, integer in `[0, 2^32)` |
| `encrypt64` / `decrypt64`   | `bigint` in `[0, 2^64)`          |
| `encrypt96` / `decrypt96`   | `bigint` in `[0, 2^96)`          |
| `encrypt128` / `decrypt128` | `bigint` in `[0, 2^128)`         |

- `key` is a `string` (UTF-8) or `Uint8Array`. An empty key throws.
- Each method is a bijection on its range: every value maps to exactly one other value, and decrypt undoes encrypt.
- Inputs are checked strictly. A wrong type throws `TypeError`. A non-integer, negative or out-of-range value throws `RangeError`. Nothing is silently wrapped.
- Widths are independent. The same key and the same input give unrelated outputs at different widths.
- It's deterministic: the same key and input always give the same output, so equal inputs are visible as equal outputs.

### How it works

- Balanced Feistel network on two halves of 16, 32, 48 or 64 bits.
- A fixed **20 rounds** for every width (`CIPHER_ROUNDS`). The round count is part of the format and can't be changed.
- Round function, shared by every width: Fᵢ(R) = trunc_h(HMAC-SHA256(kᵢ, mulmixᵢ(R))), where h is the half width and mulmixᵢ(R) = (R · mᵢ + aᵢ) mod 2ʰ with odd mᵢ. The security argument rests on HMAC being a PRF. `mulmix` is defense in depth.
- Round keys come from HKDF-SHA256 (key bytes as IKM, empty salt), derived lazily per width on first use. Each width has its own info string, so subkeys are separated:

| Width | HKDF info                    |
| ----- | ---------------------------- |
| 32    | `blind-block-cypher/u32/v2`  |
| 64    | `blind-block-cypher/u64/v1`  |
| 96    | `blind-block-cypher/id96/v1` |
| 128   | `blind-block-cypher/u128/v1` |

`encrypt96` is byte-for-byte the 0.1.0 `id96` cipher.

### Security bounds

| Width | Half | Classic Feistel bound per key | Use it for                 |
| ----- | ---- | ----------------------------- | -------------------------- |
| 32    | 16   | ≈ 2⁸ (256) values             | Obfuscation only           |
| 64    | 32   | ≈ 2¹⁶ (65,536) values         | Hiding Snowflake-style IDs |
| 96    | 48   | ≈ 2²⁴ (16.7 million) values   | `createIdGenerator` IDs    |
| 128   | 64   | ≈ 2³² (4.3 billion) values    | UUID-sized or larger IDs   |

- The bound is the conservative proven birthday bound for a Feistel network with that half width. It is a **lifetime** bound per key: there is no key rotation in the format.
- Twenty rounds give extra margin beyond the bound, but there is no number we can claim. Going past it is past what this library promises.
- The 32-bit domain is tiny. The whole codebook is only 2³² entries. Treat `encrypt32` as obfuscation, not secrecy.

### What it is not

- Not AES, not an audited block cipher, not a substitute for TLS or at-rest encryption.
- **No integrity check.** A wrong key or a tampered value decrypts silently to some other value. Anyone can construct valid-looking ciphertext.
- Not for messages, multi-block data or tokens.

### Keys

- Use a **high-entropy secret**: at least 16 random bytes. A password-like key can be brute-forced.
- Load keys from your secret store or environment. Never commit them. The keys in this repo's tests are fake.
- A leaked key exposes every value ever encrypted with it, retroactively. Changing keys means re-encrypting or re-issuing what you stored.

## Encoding layer

```ts
import { decodeBase64url, encodeBase64url } from "blind-block-cypher";

encodeBase64url(42, 32); // "AAAAKg" (6 chars)
encodeBase64url(42n, 64); // "AAAAAAAAACo" (11 chars)
encodeBase64url(42n, 96); // "AAAAAAAAAAAAAAAq" (16 chars)
encodeBase64url(42n, 128); // "AAAAAAAAAAAAAAAAAAAAKg" (22 chars)

decodeBase64url("AAAAKg", 32); // 42 (number)
decodeBase64url("AAAAAAAAAAAAAAAq", 96); // 42n (bigint)
```

`encodeBase64url(value, bits)` and `decodeBase64url(text, bits)` take `bits: 32 | 64 | 96 | 128`. 32 bits uses `number`. The other widths use `bigint`. Literal widths give exact return types, so `decodeBase64url(s, 32)` is typed `number`.

| Bits | Characters | Pad bits | Last character must be one of     | 0                        | Max                      |
| ---- | ---------- | -------- | --------------------------------- | ------------------------ | ------------------------ |
| 32   | 6          | 4        | `A Q g w`                         | `AAAAAA`                 | `_____w`                 |
| 64   | 11         | 2        | `A E I M Q U Y c g k o s w 0 4 8` | `AAAAAAAAAAA`            | `__________8`            |
| 96   | 16         | 0        | any                               | `AAAAAAAAAAAAAAAA`       | `________________`       |
| 128  | 22         | 4        | `A Q g w`                         | `AAAAAAAAAAAAAAAAAAAAAA` | `_____________________w` |

- Format: RFC 4648 base64url of the value's big-endian bytes (4, 8, 12 or 16 bytes), with no `=` padding. It matches `Buffer.from(bytes).toString("base64url")`.
- Alphabet: `A–Z a–z 0–9 - _`.
- When the bit count isn't a multiple of 6, the low bits of the last character are pad bits and must be zero.
- 96 bits is exactly 16 × 6, so it has no pad bits and every 16-character string over the alphabet is valid. It is identical to 0.1.0's ID encoding.
- Strict decoding: a wrong length, a character outside the alphabet, or a nonzero pad bit throws `InvalidIdError`. There's exactly one string per value.
- Case-sensitive. Strings may start with `-` or `_`.
- Encoding a value of the wrong type throws `TypeError`. An out-of-range value, or any other `bits`, throws `RangeError`.

## Generator layer (plaintext)

> **Warning: plain IDs are not secret.** `createPlainIdGenerator` output carries the creation second, `generatorId` and `sequence` in the clear. Anyone who sees one can read all three. Never expose a plain ID publicly unless you encrypt it first.

```ts
import { createPlainIdGenerator, packId, unpackId } from "blind-block-cypher";

const gen = createPlainIdGenerator({
  // all optional:
  // epoch: new Date("2026-01-01T00:00:00Z"),
  // generatorId: 0,           // 0..1023, unique per concurrent generator
  // now: () => Date.now(),    // ms; injectable for tests
  // randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
  // sequenceStart: undefined, // 0..2^53-1; default is a random start
});

const plain = gen.next(); // bigint in [0, 2^96)
unpackId(plain); // { generatorId, seconds, sequence }, all numbers
packId({ generatorId: 0, seconds: 86400, sequence: 7 }); // bigint
```

`createPlainIdGenerator(options?)` returns `{ next(): bigint, epochMs, generatorId }`. `epochMs` is the resolved epoch, so the creation time of a plain ID is `new Date(gen.epochMs + seconds * 1000)`.

### Layout

One 96-bit integer, most significant field first:

| Bits | Field         | Meaning                                          |
| ---- | ------------- | ------------------------------------------------ |
| 33   | `seconds`     | Whole seconds since the epoch                    |
| 10   | `generatorId` | `0`–`1023`, default `0`                          |
| 53   | `sequence`    | Per-instance counter (see [Sequence](#sequence)) |

`packId` and `unpackId` convert between the integer and its fields. Out-of-range fields or input throw `RangeError`.

### Epoch and rollover

- The default epoch is `2026-01-01T00:00:00Z`. Pass `epoch` as a `Date` or millisecond timestamp. It must land on a whole second.
- The epoch is part of the format. Decoding needs the same epoch (and, for opaque IDs, the same key).
- 33 bits of seconds is about 272 years. With the default epoch the last valid second is just before `2298-03-16T12:56:32Z`.
- A clock before the epoch, or at or past rollover, makes `next()` throw `RangeError`. It never wraps.

### Sequence

- Starts at a random 53-bit value by default. Pass `sequenceStart` to choose it.
- Adds 1 per ID. It never resets when the second changes. Past 2⁵³ − 1 it wraps to 0.
- There is no exhaustion error. A repeat within one instance needs 2⁵³ IDs (about 285 years at a million IDs per second) and the same second.

### Clock step-back

- If the clock goes backward, `next()` doesn't throw. It keeps minting at the last minted second, with the sequence still advancing, until the clock passes that second again.
- IDs stay unique through a step-back.
- The decoded time can differ from true time by up to the size of the step-back, ahead or behind.

### Uniqueness

- Generators with different `generatorId`s never collide. Give each concurrent generator its own. The library doesn't coordinate them.
- A restart, or two generators sharing a `generatorId`, can repeat IDs. The random start makes that unlikely, not impossible.
- To rule repeats out, persist the last `sequence` durably (a database, not environment config) and restart with `sequenceStart = last + 1`.

## Composition

An opaque ID is exactly:

```ts
import {
  createCipher,
  createPlainIdGenerator,
  decodeBase64url,
  encodeBase64url,
  unpackId,
} from "blind-block-cypher";

const cipher = createCipher(process.env.ID_KEY ?? "");
const gen = createPlainIdGenerator({ generatorId: 3 });

const id = encodeBase64url(cipher.encrypt96(gen.next()), 96); // 16 chars

unpackId(cipher.decrypt96(decodeBase64url(id, 96))); // back to the fields
```

That is `urlencode(encrypt(generate()))`. With the same key and options it matches `createIdGenerator` byte for byte.

## Keyed ID generator

`createIdGenerator(key, options?)` wraps the three layers. Its name, options and output are unchanged from 0.1.0: the same key and epoch give the same IDs, and old IDs still decode.

```ts
import { createIdGenerator } from "blind-block-cypher";

const ids = createIdGenerator(process.env.ID_KEY ?? "", {
  // all optional:
  // epoch: new Date("2026-01-01T00:00:00Z"),
  // generatorId: 0,
  // maxFutureSkewSeconds: 60,
  // now: () => Date.now(),
  // randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
  // sequenceStart: undefined,
  // strictTime: false,
});

const id = ids.generate();
ids.decode(id); // { date, generatorId, seconds, sequence }
ids.decode(id, { strictTime: true });
ids.decodeTime(id); // Date
```

| Call                         | Behavior                                                                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createIdGenerator(...)`     | Throws on an empty key. Throws `RangeError` for an out-of-range `generatorId` or `sequenceStart`, an epoch not on a whole second, or a negative skew. |
| `generate()`                 | Same rules as the plain generator: `RangeError` before the epoch or past rollover, no error on clock step-back.                                       |
| `decode(id)` / `decodeTime`  | Throws `InvalidIdError` unless `id` is exactly 16 characters of `[A-Za-z0-9_-]`.                                                                      |
| `decode(id, { strictTime })` | Opt-in. Also throws `InvalidIdError` when the decoded time is more than `maxFutureSkewSeconds` (default 60) past `now()`.                             |
| Wrong key                    | **Not detectable.** Any well-formed ID decodes to _some_ time, generator and sequence under any key.                                                  |

**About `strictTime`:** it rejects most forged or wrong-key IDs, because those tend to decode far in the future. It is a heuristic, not authentication. A genuine ID can decode ahead of `now()` after a clock step-back on the minting host, or because of clock skew between hosts. A step or skew larger than `maxFutureSkewSeconds` makes `strictTime` reject genuine IDs until real time catches up. If you use `strictTime` on hosts whose clocks can jump, raise the skew.

**Scale:** `createIdGenerator` is for local, small-scale use. For a large distributed system, mint Snowflake IDs with your existing service and hide them with `encrypt64`:

```ts
const publicId = encodeBase64url(cipher.encrypt64(snowflake), 64);
cipher.decrypt64(decodeBase64url(publicId, 64)); // the Snowflake again
```

- Keep the raw Snowflake internally. Ciphertext isn't sortable.
- A signed `int64` Snowflake converts with `BigInt.asUintN(64, x)` before encrypting and `BigInt.asIntN(64, y)` after decrypting.

## Errors

- `InvalidIdError` (`err.name === "InvalidIdError"`) means a string isn't a valid encoding, or failed `strictTime`.
- `RangeError` and `TypeError` mean a caller passed a bad argument.

### Dual package (ESM and CommonJS)

The package ships separate ESM (`dist/index.mjs`) and CommonJS (`dist/index.js`) builds, chosen by the `exports` map. If one process loads both, for example your app uses `import` and a dependency uses `require`, `err instanceof InvalidIdError` still works across the boundary: instances carry a shared `Symbol.for` brand. Checking `err.name === "InvalidIdError"` works too.

## Migrating from 0.1.0

- **`createIdGenerator` is unchanged.** Same signature, same keys, same IDs. Existing IDs keep decoding.
- **u32 `encrypt` / `decrypt` are gone.** Use `createCipher(key).encrypt32(x)` / `decrypt32(y)`. Outputs are **different**: the old round function was affine, which made the old cipher weak. To migrate stored values, decrypt them with 0.1.0 and re-encrypt with 0.2.0.
- **Out-of-range u32 input now throws.** 0.1.0 wrapped it with `>>> 0`. 0.2.0 throws `RangeError` (or `TypeError` for a non-number).
- **Rounds are fixed at 20.** `RECOMMENDED_ROUNDS` and the `rounds` argument are gone.
- **Low-level exports are removed:** `expandKey`, `deriveRoundKeys`, `RoundKey`, `RoundMaterial`, `createFeistel96`, `Feistel96`, `encryptBlock`, `decryptBlock`. Use `createCipher` and the encoding helpers. `permutation` stays.
- **New:** `encrypt64` and `encrypt128` widths, `encodeBase64url` / `decodeBase64url`, `createPlainIdGenerator`, `packId` / `unpackId`.
- **Packaging:** an `exports` map replaces deep imports into `dist/`. Public types use `number`, `bigint`, `Uint8Array` and `string` (no `Buffer`). The package now includes an MIT `LICENSE`.

## Develop

```bash
pnpm install
pnpm test
pnpm build
pnpm run lint:package # publint + attw on the packed tarball (after build)
pnpm run smoke:pack # require() + import() the packed tarball in one process (after build)
pnpm run bench # cipher throughput (not part of CI)
```

Source: `src/index.ts` → `dist` via `tsup`.
