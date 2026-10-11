# blind-block-cypher

Keyed, deterministic **format-preserving encryption (FPE)** over the full `u32` space (`0` … `0xffffffff`). Same `(key, rounds)` always maps a given plaintext to the same ciphertext, and every value is reachable exactly once — a bijection on 32-bit integers.

It also ships an **`id96` ID generator** (see [ID generator](#id-generator-id96)): short, nanoid-style string IDs that hide their creation time from anyone without the key.

**Scope:** opaque ID / database-key obfuscation so sequential or enumerable identifiers are not visible on the wire. This is **not** a general-purpose cipher. Do not use it for message confidentiality, authenticated encryption, streaming data, or anything that needs cryptographic strength against a serious adversary.

## Motivation

Public integer IDs leak ordering and volume. A reversible map from `u32 → u32` lets you show scrambled identifiers while still looking them up later with the same key. Feistel structure keeps the map bijective without a 4 GiB lookup table.

A 32-bit domain is tiny. Anyone who can see enough (plaintext, ciphertext) pairs, or just enough ciphertexts, can learn a lot about the mapping, and the whole codebook is only 2³² entries. Treat the `u32` cipher as **obfuscation only**. If you need time-hiding string IDs, use [`id96`](#id-generator-id96).

## Bijection

Each encrypt step is a balanced Feistel network on two 16-bit halves. Feistel rounds that XOR one half with a function of the other are always invertible (swap the round order and XOR again with the same `F`). The whole transform is therefore a permutation of `{0, …, 2³²−1}` for any fixed key and round count — no collisions, no missing codes, including edges `0` and `0xffffffff`.

## Key and rounds

| Input       | Rules                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------- |
| `key`       | Non-empty `string` (UTF-8) or `Uint8Array`. Empty key throws.                                 |
| `rounds`    | Integer `≥ 1`. `rounds < 1` throws.                                                           |
| Determinism | Same `(key, rounds)` → same mapping. Different keys (or round counts) produce unrelated maps. |

**Recommended:** `RECOMMENDED_ROUNDS` (`8`) for ID obfuscation. More rounds cost CPU; fewer weaken diffusion. Do not treat round count as a substitute for key secrecy.

## Key expansion

`expandKey(key, rounds)` derives per-round material with **HKDF-SHA256**:

- IKM: the key bytes
- Salt: empty
- Info: `blind-block-cypher/v1`
- OKM length: `rounds × 8` bytes

Each round consumes 8 bytes:

1. **mask** — 2 bytes big-endian → 16-bit XOR mask for `F`
2. **shuffleId** — 6 bytes big-endian → integer id for `permutation(16, id)` (covers `16!`)

## Feistel sketch

Treat the `u32` block as `(L, R)` — high and low 16 bits.

**Round function** `F(half, { mask, shuffleId })`:

1. `masked = half ⊕ mask` (16-bit)
2. Bit-shuffle `masked` with order `permutation(16, shuffleId)` (bit `order[i]` moves to position `i`)

**Encrypt** (one round):

```
L' = R
R' = L ⊕ F(R, roundMaterial)
```

Repeat for `rounds` rounds; join `(L, R)` with `>>> 0` so results stay unsigned 32-bit.

**Decrypt:** run the same rounds in reverse order (Feistel inverse). `F` itself need not be invertible.

Existing `permutation(n, id)` is unchanged and remains the bit-order source for `F`.

## API

```ts
import {
  RECOMMENDED_ROUNDS,
  decrypt,
  encrypt,
  expandKey,
  permutation,
} from "blind-block-cypher";

const key = "application-secret";
const rounds = RECOMMENDED_ROUNDS; // 8

const cipher = encrypt(key, rounds, 42); // u32, >>> 0
decrypt(key, rounds, cipher); // => 42

expandKey(key, rounds); // RoundMaterial[] — usually internal
permutation(16, shuffleId); // bit order array
```

Signatures:

- `encrypt(key, rounds, plaintext): number`
- `decrypt(key, rounds, ciphertext): number`
- `expandKey(key, rounds): RoundMaterial[]`
- `RECOMMENDED_ROUNDS = 8`

All public numeric block results are normalized with `>>> 0`.

## What this is not

- Not AES, not NaCl, not a substitute for TLS or at-rest encryption libraries.
- No authentication / integrity MAC — a flipped ciphertext bit still “decrypts” to some other `u32`.
- Not for passwords, tokens larger than 32 bits, or multi-block messages.
- Security depends on keeping `key` secret and treating outputs as opaque IDs only.

## ID generator (`id96`)

`createIdGenerator(key)` mints 16-character, URL-safe IDs. They're unique per generator, and only someone holding the key can read back an ID's creation time.

**Scope:** `id96` is meant for local, small-scale use, not for coordinating IDs across a large distributed system. If you run several generators at once, give each one its own `generatorId`; the library doesn't coordinate them for you. At large scale, mint IDs with a Snowflake-style service and obfuscate them with a 64-bit block cipher instead (a planned `encrypt64`, not part of this release).

### Why

Sortable IDs like ULID, KSUID, or UUIDv7 put a readable timestamp in every public ID, which exposes when records were created and how fast you are growing. Random IDs like nanoid hide that, but then you can't recover the creation time either. `id96` encrypts a timestamp together with a generator ID and a counter, so the public string looks random and the key holder can still decode the time.

### Layout

The plaintext is one 96-bit block, stored as 12 bytes big-endian:

| Bits | Field         | Source                                                                |
| ---- | ------------- | --------------------------------------------------------------------- |
| 33   | `seconds`     | Whole seconds since the epoch, from `now()` floored                   |
| 10   | `generatorId` | The `generatorId` option, `0`–`1023` (default `0`)                    |
| 53   | `sequence`    | A per-instance counter that adds 1 per ID (see [Sequence](#sequence)) |

That block is encrypted with a keyed 96-bit Feistel permutation and then encoded as base64url.

### Epoch and rollover

- The default epoch is `2026-01-01T00:00:00Z`. You can pass `epoch` (a `Date` or a millisecond timestamp), but it must land on a whole second.
- The epoch is part of the format. To decode an ID you need the same key **and** the same epoch.
- 33 bits of seconds covers about 272 years. With the default epoch the last valid second is just before `2298-03-16T12:56:32Z`.
- Time outside `[0, 2^33)` seconds, whether before the epoch or at or past rollover, makes `generate()` throw a `RangeError`. It never wraps.

### Sequence

- By default the counter starts at a random 53-bit value drawn from `randomBytes`. Pass `sequenceStart` (an integer `0`–`2^53 − 1`) to choose the start yourself.
- It adds 1 per ID and never resets when the second changes. Past `2^53 − 1` it wraps to 0. There's no exhaustion guard: it never throws, even if it comes back around to its start.
- If the clock's seconds drop **strictly below** the last second this generator minted, `generate()` doesn't throw. It keeps minting at that last second, with the counter still advancing, until the clock passes it again. IDs stay unique through a clock step-back.
- Because of that, `decodeTime` may lag real time during a clock step-back, by up to the size of the step: IDs minted while the clock is behind carry the earlier, pinned second. Measured against the host's stepped-back clock, those IDs look like they're from the future, so `decode(id, { strictTime: true })` may reject them until real time catches up (see the API section below).

### Encoding

IDs are exactly **16 characters of base64url**, the RFC 4648 alphabet `A–Z a–z 0–9 - _`. That's the same character set nanoid uses.

- 96 bits is exactly 16 × 6, so there's no padding, and every 16-character string over this alphabet is a well-formed ID.
- IDs are case-sensitive, and they may start with `-` or `_`.
- Base62 would need 17 characters and BigInt division, and it would leave some strings invalid, which is why `id96` uses base64url instead.

### API

```ts
import { createIdGenerator } from "blind-block-cypher";

const ids = createIdGenerator(process.env.ID_KEY ?? "", {
  // all optional:
  // epoch: new Date("2026-01-01T00:00:00Z"),
  // now: () => Date.now(),          // ms; injectable for tests
  // randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
  // generatorId: 0,                 // 0..1023, unique per concurrent generator
  // sequenceStart: undefined,       // 0..2^53-1; default is a random start
  // strictTime: false,
  // maxFutureSkewSeconds: 60,
});

const id = ids.generate(); // 16-char base64url string
ids.decodeTime(id); // Date the ID was minted (to the second)
ids.decode(id); // { seconds, date, generatorId, sequence }
```

| Call / input                 | Behavior                                                                                                                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createIdGenerator(...)`     | Throws on an empty key. Throws `RangeError` if `generatorId` or `sequenceStart` isn't an integer in range, if `epoch` isn't a valid time on a whole second, or if `maxFutureSkewSeconds` is negative. |
| `generate()`                 | Throws `RangeError` when the clock is before the epoch or past rollover. A clock that goes backward doesn't throw (see Sequence).                                                                     |
| `decode(id)` / `decodeTime`  | Throws `InvalidIdError` unless `id` is exactly 16 characters of `[A-Za-z0-9_-]`.                                                                                                                      |
| `decode(id, { strictTime })` | Opt-in. Also throws `InvalidIdError` when the decoded time is more than `maxFutureSkewSeconds` past `now()`.                                                                                          |
| Wrong key                    | **Not detectable.** There is no MAC, so any well-formed ID decodes to _some_ time, generator ID, and sequence under any key.                                                                          |

`strictTime` rejects most IDs that were forged or decoded with the wrong key, because those tend to land far in the future. That's a heuristic, not authentication.

A genuine ID can also decode ahead of `now()`, by up to the size of a clock step-back on the host that minted it or clock skew between hosts. A step larger than `maxFutureSkewSeconds` (default 60) makes `strictTime` reject genuine IDs until real time catches up. That is deliberate (fail-closed), so raise the skew if you use `strictTime` on hosts whose clocks can jump.

Low-level exports for tests and tooling: `createFeistel96(key)` (returns `{ encrypt, decrypt }` on a 12-byte `Uint8Array`), one-shot `encryptBlock(key, block)` / `decryptBlock(key, block)`, `deriveRoundKeys(key, info, rounds, halfBits)`, and `ID96_ROUNDS` (`20`).

### Collisions

- **Within one running generator, IDs don't repeat in practice.** The cipher is a bijection, and the counter only comes back to a value it already used after 2⁵³ IDs (about 285 years at a million IDs per second). Even then, an ID repeats only if it's also minted in the same second as the earlier one.
- **Generators with different `generatorId`s never collide with each other.**
- **Two generators that share a `generatorId`, or a restart, can repeat IDs.** A restarted process starts a new counter, so it can reuse a `(seconds, generatorId, sequence)` the old process already minted if it mints in the same second, or after its clock fell behind. The random default start makes this unlikely, but not impossible. Pinning to the last minted second can't see across restarts either.
- **To rule repeats out:** persist the last `sequence` in durable storage (a database, not environment config) and pass `sequenceStart = last + 1` when you restart, and give every concurrent generator its own `generatorId`.

### Cipher

- 96-bit Feistel network with two 48-bit halves and a fixed **20 rounds**. The round count is part of the format and can't be changed.
- Round function, in `src/round.ts` (parameterized by half width so other block sizes can share it; the `u32` cipher is unchanged in this release):

  $$
  F_i(R) = \mathrm{trunc}_{48}\big(\mathrm{HMAC\text{-}SHA256}(k_i,\ \mathrm{mulmix}_i(R))\big)
  $$

  Here `mulmix` is a keyed bijection `(R · m_i + a_i) mod 2^48` with odd `m_i`, computed exactly with 24-bit limbs. `F` takes the first 48 bits of `HMAC-SHA256(hmacKey_i, mulmix_i(R) as 6 big-endian bytes)`. The security argument rests on HMAC being a PRF; `mulmix` is defense-in-depth.

- Round keys come from `deriveRoundKeys`: one **HKDF-SHA256** call per round, domain-separated from the `u32` cipher:
  - IKM: the key bytes
  - Salt: empty
  - Info: UTF-8 `blind-block-cypher/id96/v1` followed by one round-index byte
  - OKM length: 44 bytes, split as `hmacKey` = bytes `0..32`, `m` = bytes `32..38` as a 48-bit big-endian integer (forced odd), and `a` = bytes `38..44` as a 48-bit big-endian integer
- Halves are plain JS numbers (48 bits fits under 2^53). There's no BigInt in the hot path, and the only dependency is Node `crypto`. Each ID costs 20 HMAC-SHA256 calls. `decode` returns plain safe-integer Numbers, with no BigInt.

### Security: what `id96` is and isn't

**It is** keyed ID obfuscation built on a standard PRF-based (Luby–Rackoff) Feistel construction. Without the key, an ID should look random and reveal neither creation time nor ordering.

**It isn't** an audited block cipher, general-purpose encryption, or authentication:

- There's no integrity check. Anyone can construct a well-formed ID, and a wrong key decodes silently.
- **Usage bound.** The conservative proven bound for a Feistel with 48-bit halves is about 2²⁴ ≈ 16.7 million IDs per key. v1 has no key rotation, so that is a **lifetime** bound for each key. Twenty rounds give substantial extra margin beyond it, but there is no specific number we can claim. Minting far more than 2²⁴ IDs under one key goes past what this library can promise.
- Each key must be a **high-entropy secret**: at least 16 random bytes is recommended. A password-like key can be brute-forced by anyone who knows roughly when one ID was minted.
- **Load keys from your secret store or environment variables**, never from committed config. The keys in this repo's test fixtures are deliberately fake. Don't copy them into production.

### Key compromise

- A leaked key exposes the creation time of **every ID ever minted** with it, retroactively.
- v1 has **no in-format key rotation**. A key can't be retired while its IDs still need to decode, so changing keys means re-issuing or re-mapping existing IDs yourself.
- If rotation is ever needed, the planned path is a future v2 format with a 17-character ID that carries a key-version prefix. Length alone separates v1 IDs (16 characters) from v2 IDs (17), so existing v1 IDs would keep decoding with the v1 key.

## Install / develop

```bash
pnpm install
pnpm test
pnpm build
pnpm run bench # id96 IDs/sec at 20 rounds (not part of CI)
```

Package entry: `src/index.ts` → `dist` via `tsup`.
