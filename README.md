# blind-block-cypher

Keyed, deterministic **format-preserving encryption (FPE)** over the full `u32` space (`0` … `0xffffffff`). Same `(key, rounds)` always maps a given plaintext to the same ciphertext, and every value is reachable exactly once — a bijection on 32-bit integers.

**Scope:** opaque ID / database-key obfuscation so sequential or enumerable identifiers are not visible on the wire. This is **not** a general-purpose cipher. Do not use it for message confidentiality, authenticated encryption, streaming data, or anything that needs cryptographic strength against a serious adversary.

## Motivation

Public integer IDs leak ordering and volume. A reversible map from `u32 → u32` lets you show scrambled identifiers while still looking them up later with the same key. Feistel structure keeps the map bijective without a 4 GiB lookup table.

## Bijection

Each encrypt step is a balanced Feistel network on two 16-bit halves. Feistel rounds that XOR one half with a function of the other are always invertible (swap the round order and XOR again with the same `F`). The whole transform is therefore a permutation of `{0, …, 2³²−1}` for any fixed key and round count — no collisions, no missing codes, including edges `0` and `0xffffffff`.

## Key and rounds

| Input | Rules |
| --- | --- |
| `key` | Non-empty `string` (UTF-8) or `Uint8Array`. Empty key throws. |
| `rounds` | Integer `≥ 1`. `rounds < 1` throws. |
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
  encrypt,
  decrypt,
  expandKey,
  permutation,
  RECOMMENDED_ROUNDS,
} from "blind-block-cypher";

const key = "application-secret";
const rounds = RECOMMENDED_ROUNDS; // 8

const cipher = encrypt(key, rounds, 42);       // u32, >>> 0
const plain = decrypt(key, rounds, cipher);    // 42

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

## Install / develop

```bash
pnpm install
pnpm test
pnpm build
```

Package entry: `src/index.ts` → `dist` via `tsup`.
