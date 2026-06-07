## account & key derivation

How a brace account works: there is **no account on the server** in the
traditional sense — the user's `(username, password)` pair _is_ the account.
From it the client deterministically derives a **key-encryption-key** that
unwraps a random **data key**, and from that data key it derives every key it
needs. See [architecture.md](./architecture.md) for package layering,
[api-contracts.md](./api-contracts.md) for how the create-account endpoint is
typed, and [local-first-sync.md](./local-first-sync.md) for what the derived
encryption key protects. The crypto implementation lives in
`@stxapps/web-crypto`; the frozen parameters and validators live in
`@stxapps/shared` (`crypto/params.ts`, `auth/credentials.ts`).

### the model: a password-derived wallet, with extra doors

brace is a **zero-knowledge** bookmark manager. The server stores only
ciphertext and never sees the password, the data key, or any private key. That
makes the account model structurally identical to a **crypto wallet**:

- the secret **is** the account — no email, no server-side password reset;
- keys are derived **deterministically**, the same way every time, on every
  device;
- the default door is the password, and **if it is the only door, there is no
  recovery** — lose it and the data is gone, exactly like a wallet seed phrase.

The one place it differs from a wallet is the part that matters most — **where
the entropy comes from** — and that difference drives every rule below.

|                     | 24-word seed (BIP-39)         | brace `(username, password)`                                |
| ------------------- | ----------------------------- | ----------------------------------------------------------- |
| entropy source      | **forced random** (~256 bits) | **user-chosen** — whatever they pick                        |
| offline brute force | infeasible, period            | feasible **if the password is weak**                        |
| per-guess cost      | —                             | Argon2id (64 MiB, ~1–3s) — raises cost, **adds no entropy** |
| recovery            | none                          | optional — see [the doors](#the-doors)                      |

A wallet _forces_ high entropy; brace _trusts the user_ to choose it. Argon2id
(memory-hard) makes each guess expensive — this is what defeated the old
SHA-256 "brain wallets" that got drained — and the per-user salt stops shared
rainbow tables. But neither manufactures entropy: **the security of the password
door is bounded by the entropy of the password.** A generated 6-word passphrase
approaches wallet-grade; `Summer2026!` does not.

> The product goal is _wallet-grade safety with better UX_. Two things buy that:
> (1) steering users toward enough password entropy (see [generated
> password](#generated-password-recommended-default)), and (2) the **DEK door
> model** below, which lets us add a recovery code / passkey as _additional_
> doors without giving the server the ability to decrypt anything. UX
> convenience must not quietly become a weak-key generator.

### the DEK / KEK door model

The root of an account is **not** the password. It is a random **DEK** (data
encryption key) — 32 bytes from a CSPRNG, generated once at create-account and
never derived from anything. The keypair and encryption key are derived from the
**DEK**; each access method ("door") derives a **KEK** (key-encryption-key) that
**wraps** (AEAD-encrypts) its own copy of the DEK:

```
                         random DEK  (32 bytes, the real root)
                          │
        ┌─────────────────┼──────────────────┐
        │                 │                  │
   password-KEK      recovery-KEK        passkey-KEK      ← each door derives a KEK
        │                 │                  │
   wrap(DEK)         wrap(DEK)           wrap(DEK)        ← N wrapped blobs,
        │                 │                  │              stored server-side (ciphertext)
        └────── any one unwraps ──▶ DEK ─────┘
                                     │
                                     ├─ HKDF(info="brace-auth-seed") ──▶ Ed25519 keypair
                                     │                                     ├─ publicKey  (credential, sent)
                                     │                                     └─ sign()     (private key, never leaves the module)
                                     └─ HKDF(info="brace-encryption-key") ──▶ AES-256-GCM key (non-extractable, never sent)
```

Any single door unwraps the same DEK; the DEK derives everything else.

**Why a DEK instead of encrypting the data once per door:** the indirection lets
us **encrypt the data once and open it through many cheap, independently
revocable doors.** Data is encrypted under the DEK; each door wraps only the
32-byte DEK. Adding/removing a door, or changing a password, re-wraps 32 bytes
and **never touches the data**. Without it, every door would have to encrypt all
the data and a password change would re-encrypt everything.

The wrapped blobs are ciphertext, so storing them server-side stays
**zero-knowledge** — the server holds locked boxes it can't open. It hands a
door's blob to anyone who asks for a username (it's needed _before_ auth); that
exposure is the same as today, where an attacker with the `publicKey` or any
ciphertext can mount an offline Argon2id attack on a weak password.

### the doors

| door              | input entropy     | KDF for the KEK                                   | when                   |
| ----------------- | ----------------- | ------------------------------------------------- | ---------------------- |
| **password**      | low (user-chosen) | **Argon2id** (memory-hard) over the per-user salt | always (primary)       |
| **recovery code** | high (CSPRNG)     | **HKDF** (input already high-entropy)             | launch                 |
| **passkey**       | high (PRF secret) | **HKDF** over the WebAuthn PRF output             | later, where supported |

- **password door** — `password-KEK = Argon2id(password, salt)`, where
  `salt = SHA-256(APP_SALT ‖ canonicalizeUsername(username))` (the per-user
  salt described below). Memory-hard because the input is low-entropy.
- **recovery code** — generated with `crypto.getRandomValues` (≥256 bits, shown
  once as grouped base32). Already high-entropy, so a cheap
  `recovery-KEK = HKDF(recoveryCode, info="brace-recovery-kek")` suffices.
- **passkey** — needs the **WebAuthn PRF extension** (built on `hmac-secret`):
  the authenticator returns a stable per-credential pseudorandom secret, and
  `passkey-KEK = HKDF(prfSecret, …)`. A plain passkey only _signs_ — it can't
  decrypt — so PRF is what turns it into a door. PRF is on Chrome + Safari with
  platform authenticators but not universal; fall back to password/recovery
  where it's missing. A platform passkey synced via iCloud Keychain / Google
  Password Manager is a **per-device door the platform backs up for free** — the
  door users are least likely to lose.

**Wrapping format.** Wrap with an **AEAD** (AES-256-GCM) so a wrong/tampered
blob fails cleanly, and bind each blob to its door with the AAD so a malicious
server can't pass off one door's blob as another's:

```
blob = AES-256-GCM(key = KEK, plaintext = DEK, aad = doorType)
stored per door: { doorType, iv, ciphertext+tag }
```

The AAD is **only the `doorType`, deliberately not the user.** The KEK already
binds the user — the password door folds the username into its salt (so a
cross-user blob unwraps with a different KEK and fails the GCM tag anyway), and
the recovery/passkey KEKs come from a per-user secret. Re-binding the user in the
AAD would be redundant _and_ would couple every door to the username, so a future
username change (which by design re-wraps only the password door) would have to
re-wrap the username-independent doors too. `doorType` is the one piece of
context not already carried by the KEK, so it is the whole AAD. (Defined once as
`dekWrapAad` in `crypto/doors.ts`, part of the frozen contract.)

> **Security floor = the weakest door.** An attacker takes the easiest of the
> doors, so every door must be strong: the recovery code CSPRNG-generated, the
> passkey hardware-backed. The recovery code is the one humans mishandle —
> generate it, never let users type their own.

### rotation & revocation — two tiers

| tier              | trigger                                             | work                                                                                                      | publicKey / data |
| ----------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------- |
| **door rotation** | change password, add/remove recovery, revoke device | re-derive that one KEK; re-wrap or **delete** that blob                                                   | **unchanged**    |
| **DEK rotation**  | DEK believed exposed                                | new DEK; re-derive keypair (**publicKey changes**) + enc key; **re-encrypt all data**; re-wrap every door | changes — rare   |

Revoking a device is just deleting that door's wrapped blob (plus its `sessions`
row) — no re-encryption, as long as the DEK itself wasn't exposed.

### the derivation pipeline

One synchronous pass, run inside a Web Worker (Argon2id is ~1–3 s of CPU, kept
off the main thread). On **sign-in**:

```
(username, password)
        │  salt = SHA-256(APP_SALT ‖ canonicalUsername)
        ▼
   Argon2id(password, salt)  ──▶  password-KEK
        │
        │  AEAD-unwrap the fetched password-door blob   (wrong password fails on the GCM tag)
        ▼
       DEK (32 bytes)
        │
        ├─ HKDF(info="brace-auth-seed") ──▶ Ed25519 keypair → publicKey, sign()
        └─ HKDF(info="brace-encryption-key") ──▶ AES-256-GCM key
```

On **create-account** the DEK is generated fresh (not unwrapped), then wrapped
under each chosen door.

- **Per-user salt** — `SHA-256(APP_SALT ‖ canonicalizeUsername(username))`.
  Folding the unique username in means two users who pick the _same_ password
  derive different `password-KEK`s, with nothing stored server-side beyond the
  wrapped blob. `APP_SALT` is the app-wide domain separator against precomputed
  tables shared across apps. The username is a **public, deterministic** salt:
  it de-duplicates passwords but doesn't hide a targeted user, so the real cost
  against a focused attacker is Argon2id's memory-hardness, not the salt.
- **`DEK`** and the derived sub-keys never leave `@stxapps/web-crypto`; only the
  public key / signatures cross the boundary.
- **`publicKey`** is the Ed25519 public key (hex). It is a **credential**, not an
  identifier — see [the two identifiers](#the-two-identifiers).

These parameters are a **frozen cross-platform contract** in `crypto/params.ts`:
web, extension, and the future Expo client must all use the exact same
`APP_SALT`, `ARGON2_PARAMS`, HKDF labels, AEAD scheme, and `canonicalizeUsername`
rule, or a door fails to unwrap the DEK and the user is locked out. **They can
never change once real users exist.** (The DEK is random, so it is _not_ part of
the frozen contract — only the machinery that derives KEKs and unwraps it is.)

### username — rules and why

Defined once in `auth/credentials.ts` (`usernameSchema`) and enforced
identically on the form and the server:

| rule             | value                     | why                                                         |
| ---------------- | ------------------------- | ----------------------------------------------------------- |
| length           | **3–32** chars            | short enough to type, long enough to be distinct            |
| charset          | `[a-zA-Z0-9_]`            | unambiguous, URL-safe, no Unicode confusables in the handle |
| canonicalization | `trim → NFKC → lowercase` | one deterministic form (`canonicalizeUsername`)             |

The username does double duty: it is the **public handle** (the server's
case-insensitive `UNIQUE` key) _and_ the **password door's salt input**. Because
the canonicalization rule is folded into KEK derivation it is part of the frozen
contract. But note the DEK model **decouples the username from the data**: it
salts only the `password-KEK`, not the DEK. So a rename re-derives that one KEK
and re-wraps the DEK — it does **not** re-key data — which makes an editable
username feasible later if we want it (re-wrap + update the `UNIQUE` handle),
rather than "create a new account and migrate." Until that's built, treat it as
effectively permanent.

### password — rules and entropy

`passwordSchema` enforces **8–128** characters. Read these as a _length_ floor
and a hashing bound, **not** a security guarantee:

- **min 8** is the absolute minimum the form accepts. It is **not** enough
  entropy on its own — a human-chosen 8-character password is routinely
  ~20–30 bits and brute-forceable offline once an attacker has the `publicKey`
  or any ciphertext (Argon2id slows this, but a determined attacker with a weak
  target still wins).
- **max 128** bounds the Argon2id input; well above any real passphrase.

Rough entropy targets, for calibration:

| secret                                  | approx. entropy | verdict                            |
| --------------------------------------- | --------------- | ---------------------------------- |
| human "strong" password (`Summer2026!`) | ~25–35 bits     | **weak** — do not rely on it       |
| 6-word diceware passphrase              | ~77 bits        | **good** — approaches wallet-grade |
| 8-word diceware passphrase              | ~103 bits       | strong                             |
| BIP-39 24-word seed                     | ~256 bits       | wallet reference point             |

> **STATUS — not yet built:** the schema enforces only _length_. There is no
> _entropy_ gate yet. Before launch, add a strength estimator (e.g. zxcvbn) with
> a hard floor on estimated entropy, surfaced as a meter on the create-account
> form. The length rule and the entropy rule are separate concerns.

### generated password (recommended default)

> **STATUS — proposed feature, not yet built.**

The cleanest way to get wallet-grade entropy with better-than-wallet UX is to
**offer a generated passphrase as the default**, and let users override with
their own only behind a strength gate:

- generate **6 words** (default, ~77 bits) from a curated EFF-style wordlist
  using `crypto.getRandomValues` (a CSPRNG — never `Math.random`);
- present it like a wallet seed: show it once, "copy" + "I've written this
  down" confirmation, and a plain "there is no recovery" warning;
- the words are just a high-entropy `password` — they flow through the password
  door above, so **no derivation changes are needed**, only UI.

This keeps the promise: a user _can_ pick their own username and password (good
UX), but the **safe path is the default path** (wallet-grade entropy), rather
than relying on every user to invent a strong secret.

### the two identifiers

A common source of confusion: an account has **one identifier and one
credential**, not "two ids."

| name        | what it is                                                                                                                       | derived/stored where                                             | sent to server?        |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------- |
| `userId`    | the account's **stable primary key** — random, server-minted (`newId()`); also the Durable Object address (`idFromName(userId)`) | brace-api `users` table                                          | issued _by_ the server |
| `publicKey` | the **credential** — Ed25519 public key the server verifies signatures against                                                   | derived on the client from the DEK; stored as `users.public_key` | yes (it's public)      |

Why keep a separate random `userId` instead of using the `publicKey` as the id:

- **stability / addressing** — a stable `userId` is the immutable DO address and
  foreign-key target. With the DEK model the `publicKey` is now **stable across
  password changes** (a password change only re-wraps the DEK; the DEK-derived
  keypair is unchanged) and changes _only_ on the rare DEK rotation — but
  `userId` stays the one value safe to denormalize (e.g. into `sessions`) and
  reference everywhere. `public_key` is **not denormalized into `sessions`**:
  `user_id` is immutable and read on every request; `public_key` is read only at
  sign-in.
- **no credential leakage** — a separate id keeps the public key in exactly one
  place rather than sprinkled across sessions, op-logs, and every reference.

**One credential, many doors — and why that's not a contradiction.** There are
now several doors, but they are about **decryption** (unwrapping the DEK), not
**authentication**. The server still verifies exactly one thing: a signature
from the DEK-derived `publicKey`. So `publicKey` stays a single **column** on
`users`, not a 1:N `credentials` table — the multiplicity lives in the
`account_keys` table (one wrapped-DEK row per door), not in server credentials.
A passkey or
recovery code unwraps the DEK, after which the client derives the same keypair
and authenticates with it; no door is its own server credential.

So: identify by `userId` (and the human-facing `username`), **authenticate** by
a signature the `publicKey` verifies. The client proves ownership by signing a
timestamped `{ publicKey, username, action, timestamp }` payload with the
Ed25519 private key at create-account / sign-in.

> **The load-bearing sign-in check.** The server **cannot** verify that a
> keypair was honestly derived — a client can sign a valid payload with _any_
> keypair and _any_ username. That is fine, but only if the server, on sign-in,
> checks the presented `publicKey` against the **stored** `users.public_key` for
> that username — not merely that the signature is internally valid. The flow:
> (1) client sends username → server returns the **password-door** wrapped blob;
> (2) client unwraps the DEK with `Argon2id(password, salt)` (a wrong password
> fails on the GCM tag), derives the keypair, and signs; (3) server verifies the
> signature against `payload.publicKey`, confirms
> `payload.publicKey === users.public_key` for the username, and checks `action`
>
> - a fresh `timestamp`. Skipping the comparison in step 3 would let anyone
>   "sign in" with their own key. On create-account there is no stored key yet, so
>   that comparison is replaced by the `username` UNIQUE check, the presented
>   `publicKey` is stored, and the door blobs are stored alongside it.

> **STATUS — partially built:** the client derives `publicKey` and signs the
> payload (`use-create-account.ts`); the DEK indirection, the wrapped-blob
> storage, the `users.public_key` column, and the sign-in check above are **not
> implemented yet** — see the TODOs in `apps/brace-api/src/services/account.ts`
> and [api-contracts.md](./api-contracts.md).

### why the wrapped DEK is served pre-auth — the offline-attack surface

Step 1 of the sign-in check hands the **password-door `wrapped_dek` to anyone who
names a username**, before any authentication. It has to: the client can't derive
anything until it has the blob. So the blob is an **offline brute-force oracle** —
an attacker fetches it once, then locally runs `Argon2id(guess, salt)` → try to
AEAD-unwrap → the GCM tag confirms a hit, with **no server round-trip and so no
rate-limit**. This is the same exposure direct derivation had (the `publicKey`
was the oracle then); the DEK model neither adds nor removes it.

**The defense is entropy, not secrecy of the blob.** Like a wallet, the
derivation is semi-public and the entropy is the wall: against a 6-word generated
passphrase (~77 bits) the freely-served blob is not a practical risk, while
`Summer2026!` falls regardless of how the blob is served. This is why the open
items lead with the **entropy gate + generated passphrase** rather than gating
the blob — that is the load-bearing mitigation.

**Could we gate the blob behind a proof instead?** Requiring the client to prove
knowledge of a password-derived secret before the server releases the blob would
convert the _offline_ attack into an _online_, rate-limitable one. Two limits
make this a poor trade _today_:

- A naive "store a KEK public key, require a challenge signature" only helps if
  that verifier is **never served pre-auth** (otherwise it's just another offline
  oracle), and it still **does not survive a DB breach**: the verifier sits in the
  same row as the `wrapped_dek`, so a dump yields the blob and it's offline-
  attackable anyway. Gating defends only the _pre-auth-fetch_ vector — a random
  external scraper — and mostly only when the password is weak, which is exactly
  what the entropy gate removes. It overlaps heavily with "require strong
  passwords" while adding frozen-contract surface.
- The _correct_ strong form is a **PAKE — specifically OPAQUE** (asymmetric PAKE).
  Its `export_key` output is designed precisely to encrypt a client-side secret
  like our DEK, and because a server-held OPRF key participates in deriving the
  KEK, the blob alone is useless without online interaction (and the OPRF key can
  live in a KMS so a DB-only breach stays safe). That is genuinely "best" for the
  password door — at the cost of real complexity, scarce audited Workers
  implementations, and a frozen-contract commitment.

**The DEK indirection keeps OPAQUE a future, isolated swap.** Each door wraps the
same DEK independently, so the password door could later become OPAQUE (use its
`export_key` as that door's KEK) **without touching the DEK, the data, or the
recovery/passkey doors**. High-entropy doors (recovery code, passkey-PRF) never
need a PAKE — offline-attacking a 256-bit secret is infeasible — so a hybrid
(password = OPAQUE, others = plain KEK-wrap) composes cleanly with the model.

**Decision (pre-launch):** keep the blob served pre-auth; lean on the entropy
gate + generated passphrase as the real defense; add cheap **rate-limiting +
username-enumeration protection** on the blob-fetch path to blunt mass-scraping.
Treat OPAQUE as the documented upgrade path for the password door, adopted only
if online-only (or KMS-isolated breach-resistant) password protection becomes a
requirement; skip the naive KEK-signature half-measure.

### storage durability — the most critical state in the system

The DEK model introduces a hard new dependency that direct derivation did not
have. Spell it out, because the failure is fatal and silent:

> **The wrapped-DEK blobs and the `users` table are Tier-0, irreplaceable
> state. If they are lost, the account is dead — permanently, with correct
> credentials.** The DEK is _random_; nothing can recompute it. Lose every
> wrapped copy and all doors are gone, so the encrypted bookmarks — which still
> sit safely in storage — can never be decrypted again. This is strictly worse
> than the old direct-derivation model, where `(username, password)` alone
> regenerated the keys from nothing. Recovery doors do **not** save you here: a
> recovery code is a _KEK_, not a copy of the DEK, so it only defends against
> _forgetting the password_ — never against _us losing the blob_. Different
> failure mode, no overlap.

The `users` row is equally load-bearing: it is the auth credential
(`public_key`) and the uniqueness namespace (`username`). Losing it loses
sign-in and orphans the data.

So this Tier-0 state — the `users` row **and** its wrapped DEKs — lives in **D1**
(`account_keys` inline with `users`, in the same shard, so they commit together).
The `usernames` directory is also Tier-0 (it's the only path from a handle to an
account) but lives in its own D1; the two are backed up as one set. Only the
**bulk encrypted bookmarks** (large, and already mirrored by the client's
local-first copy) go to R2.

> **Tradeoff taken (greenfield):** splitting the directory into its own D1 means
> the Tier-0 set spans **multiple** D1 databases with **separate** PITR timelines,
> and create-account is **claim-then-write**, not one transaction (the three steps
> in the schema section above). We
> accept this now to never hit the 10 GB cap and to make adding a shard a
> no-code-change, no-migration event. `users`↔`account_keys` atomicity and
> username uniqueness are both preserved; only the claim↔account link is
> non-transactional (orphan = a reclaimable directory row).

#### the split: D1 for the account + keys, R2 for bulk ciphertext

| store                 | holds                                                                       | why                                               |
| --------------------- | --------------------------------------------------------------------------- | ------------------------------------------------- |
| **D1** (SQLite)       | `usernames` (directory) · `users` + `account_keys` (per shard) · `sessions` | relational, `UNIQUE` username, per-db Time Travel |
| **R2** (object store) | the bulk encrypted bookmark blobs                                           | large, cheap, no egress; not key material         |

A wrapped DEK is ~80 bytes (32-byte DEK + IV + GCM tag), so it lives **inline in
D1**, in the same row as its index — not in R2. R2 has no native object
versioning and would force a second store with no shared transaction; D1 keeps
the keys atomic with the credential and gives them free 30-day PITR. Reserve R2
for what it's actually best at — the large bookmark ciphertext — which the
client also holds locally, so an R2 loss degrades to a re-sync, not a death.

Concrete D1 schema, across **three databases** (split now, while greenfield —
see [the sharding seam](#future-sharding-d1--the-seam-is-pre-cut)). The username
is held in its own **`DIRECTORY_DB`** (the global uniqueness namespace, never
sharded), the account rows in account **shards** (`ACCOUNTS_DB_1`, …), and
sessions in **`SESSIONS_DB`** (high-churn, not Tier-0). Mirrored in
`apps/brace-api/src/db/schemas/{directory,accounts,sessions}.sql`.

```sql
-- DIRECTORY_DB --------------------------------------------------------------

-- the global uniqueness namespace + username→shard map. PK = the UNIQUE check;
-- the claim is a single `INSERT ... ON CONFLICT DO NOTHING` (race-free).
-- account_db_id is the EXPLICIT shard holding this user's rows (e.g. '1'),
-- assigned at create-account (assignAccountDbId) and resolved by db-routes. NOT
-- NULL — every row self-describes its shard, so adding a shard never rewrites
-- existing rows (they keep their stored id).
CREATE TABLE usernames (
  username      TEXT PRIMARY KEY,        -- canonical (trim→NFKC→lowercase)
  user_id       TEXT NOT NULL,
  account_db_id TEXT NOT NULL            -- e.g. '1' ⇒ ACCOUNTS_DB_1
);
CREATE INDEX idx_usernames_user_id ON usernames(user_id);

-- ACCOUNTS_DB_N (one per shard) ---------------------------------------------

CREATE TABLE users (
  id         TEXT PRIMARY KEY,           -- random, server-minted (newId())
  public_key TEXT NOT NULL UNIQUE,       -- ed25519 hex — the credential
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- one row per door; the wrapped DEK lives inline. Stays in the SAME shard as
-- `users` so credential + key commit together in one batch.
CREATE TABLE account_keys (
  user_id     TEXT NOT NULL REFERENCES users(id),
  door_type   TEXT NOT NULL,             -- 'password' | 'recovery' | 'passkey'
  wrapped_dek BLOB NOT NULL,             -- AES-256-GCM(KEK, DEK), aad = doorType
  iv          BLOB NOT NULL,             -- GCM nonce for this wrap
  version     INTEGER NOT NULL,          -- bumped on each re-wrap (audit/debug)
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, door_type)
);

-- SESSIONS_DB ---------------------------------------------------------------

-- bearer-token sessions. account_db_id denormalized so the auth guard routes
-- "token → user → accounts shard" in one read. No FK (different db); not Tier-0.
CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  token_hash    TEXT NOT NULL UNIQUE,
  user_id       TEXT NOT NULL,
  account_db_id TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
```

**Create-account is cross-DB (claim-then-write).** Because the directory and the
account rows live in different databases, there is no single transaction:

1. **Claim** the username in `DIRECTORY_DB` (`INSERT … ON CONFLICT DO NOTHING`) —
   the authoritative, race-free uniqueness gate; a lost race is a clean 409.
2. **Write** `users` + every `account_keys` door in the shard, in one atomic
   `db.batch` (all-or-nothing within the shard).
3. **Compensate**: if step 2 fails, **release** the claim so the name isn't
   orphaned (best-effort; a sweeper backstops it).

Uniqueness is always enforced and `users`↔`account_keys` stay atomic; only the
claim↔account link is non-transactional, and its worst case is a reclaimable
orphan username — never data loss or a uniqueness violation. Claim-then-write
(not write-then-claim) so a routine taken-username fails fast at step 1 before any
shard write, and the only possible orphan is a tiny directory row, not an
unreachable account carrying wrapped DEKs.

#### the rules

1. **Account write is one transaction; the username claim is a compensated
   step.** Create-account writes the `users` row and its `account_keys` rows in a
   **single shard transaction** (`db.batch`) — no ordering to get wrong within the
   account. The `usernames` claim is in a different db, so it's the one
   cross-store step: claim first, then write, then release on failure (the orphan
   is a reclaimable directory row — never a half-written account). The bulk
   ciphertext goes to R2 separately, but it is _not_ key material: a missing bulk
   blob is recoverable from the client's local copy, so it isn't Tier-0.
2. **Re-wrap is one atomic UPDATE.** A password change re-derives the
   password-KEK and `UPDATE`s that door's `wrapped_dek` / `iv` / `version` in
   place, atomically. Time Travel is the safety net if a bad write slips through
   — no manual versioned-blob dance needed (that complexity only existed to
   paper over R2's lack of versioning).
3. **Revoke = delete the door's row**, deliberately (plus its `sessions` row).
   The DEK is unchanged, so the other doors keep working — no re-encryption.
4. **Bulk R2 hygiene.** Keep the bookmark bucket free of any lifecycle rule that
   could silently expire a user's server copy; route deletes through a separate
   admin path, not the hot request path.

#### backups & replication (set up before launch)

- **D1 Tier-0 set — `DIRECTORY_DB` (`usernames`) + every account shard (`users` +
  `account_keys` / wrapped DEKs):** Time Travel is always on and free — any point
  in the **last 30 days** is restorable (`wrangler d1 time-travel restore`). Note
  these are now **separate databases with separate timelines**, so a
  point-in-time restore that must stay consistent across the directory and a shard
  is a per-db operation — pick a quiet point and restore each. For retention
  beyond 30 days, run a **scheduled D1 export** (REST API + Workflows / a
  Cron-triggered Worker) daily for **each** of these dbs, and copy at least the
  weekly dump **off Cloudflare** (e.g. to S3) so a platform-level account problem
  can't take the Tier-0 state with it. (`SESSIONS_DB` is not Tier-0 — skip it.)
- **R2 (bulk ciphertext):** R2 is durable but **not versioned**. This data is
  lower-stakes (the client's local-first copy is a second replica), but still
  guard against accidental delete/overwrite with **R2 event notifications →
  Queue → Worker** replicating writes to a second bucket.
- **Test restores.** A backup you have never restored is not a backup —
  periodically restore D1 to a scratch DB and confirm a sample of wrapped DEKs
  still unwrap.

#### why not the per-user Durable Object?

We already run a Durable Object per user (`idFromName(userId)`), so it's natural
to ask why the keys don't live there. **Backup is no longer the reason not to** —
SQLite-backed DOs now have **30-day point-in-time recovery, on by default**
(only the legacy KV-backed DOs lack it). The reasons are structural:

1. **You can't reach the DO without D1 first.** The DO is addressed by `userId`,
   but sign-in presents a **username**. The username→userId resolution and the
   global `UNIQUE(username)` constraint can only live in a global store (D1) — a
   per-user DO can't enforce global uniqueness. So D1 is unavoidable regardless;
   the only question is whether the keys join it there.
2. **Keys-in-DO recreates the two-store hazard.** `users` in D1 + wrapped DEK in
   the DO is the same split-brain (ordering, orphans, reconciliation) as
   D1↔R2 — just relocated. Inline in D1 collapses it to one transaction.
3. **The password-door blob is read _pre-auth_.** Serving it from D1 is a cheap
   indexed read; serving it from the DO wakes the user's object on every sign-in
   attempt — including attacker username-probes — adding latency and a
   force-instantiation DoS surface.
4. **One restore timeline, not N.** D1 PITR restores the credential and its keys
   together with one command; DO PITR is per-object, so a _consistent_ restore
   across the registry plus every affected DO is far harder.

The DO's real job is the user's **bookmark data / sync / op-log** (strong
per-user consistency, now PITR-backed). Keep that there; keep the tiny, pre-auth,
Tier-0 wrapped DEK beside its credential in D1.

#### future: sharding D1 — the seam is pre-cut

A single 10 GB D1 holds **millions** of accounts (≈1 KB each — `users` +
`account_keys`), so actually needing a second shard is years away or never. But
because this is greenfield, the **sharded topology is already in place** (cheapest
it'll ever be) so capacity is never a worry and adding a shard migrates nobody:

- the **`usernames` directory** is its own database, `DIRECTORY_DB` — the global
  uniqueness namespace, never sharded (and ~140M usernames fit in one 10 GB db,
  ~20× the per-shard account capacity);
- the account rows live in shards: `ACCOUNTS_DB_1` today, `ACCOUNTS_DB_2`, … later
  (`users` + `account_keys` always together in one shard);
- every directory/session row carries an explicit **`account_db_id`** (NOT NULL,
  e.g. `'1'`), assigned by `assignAccountDbId()` at create-account — so each row
  self-describes its shard and existing rows are never rewritten when one is added;
- **`db/db-routes.ts`** (`accountsDb(env, accountDbId)`) resolves the id → shard
  binding by **reading** the stored id, never hashing the userId — so a user
  never moves once assigned;
- **sessions** live in their own `SESSIONS_DB`;
- **create-account already pays the cross-DB cost** (claim-then-write +
  compensate; see above) — so adding a shard later changes no code path, only
  data: provision `ACCOUNTS_DB_2`, add its binding + a `case '2'` in
  `db-routes.ts`, and return `'2'` from `assignAccountDbId()`. Existing rows keep
  their stored `'1'`, untouched.

What makes this work — and shard-later trivial — is the access shape, not luck:

- **Shard key = `userId`.** It's random (`newId()`) and uniform, and _every_
  access is "by this user" → a single shard. Routing is a pure function of the
  key, never a scan.
- **Bounded rows per user** (1 in `users`, ≤3 in `account_keys`) means no single
  user can overflow a shard, distribution stays even, and migrating to shards
  later is an **online, user-by-user** move (read a user's handful of rows,
  write them to the target shard, update the directory). This holds _only_
  because per-user-unbounded data (bookmarks) lives in R2 / the per-user DO —
  **never put unbounded per-user data in D1**, or this property breaks.

The one genuinely cross-shard concern is the global **`UNIQUE(username)`**
constraint: usernames can't be unique across shards keyed by `userId`. Solve it
with a tiny global **directory** table — `username → (userId, shardId)` — which
sign-in hits first (it arrives with a username, not a userId) to both resolve
the shard and enforce uniqueness. At ~70 B/row that directory holds **~100M+
usernames in one 10 GB db**, so the unshardable part outscales the sharded part
by an order of magnitude. (Algorithmic `hash(userId) % N` routing avoids a
directory but makes changing `N` a rehash/move; the directory costs one hop but
allows moving individual users and uneven shards.)

Two things to **avoid**, as they would make sharding hard:

- **Sequential / fan-out search** ("try db1, then db2…") — O(N) per lookup and it
  breaks uniqueness ("first match wins" lets two shards both claim a username).
  Always route deterministically via the directory or hash.
- **Cross-user JOINs in D1** (global feeds, social graphs, "search all users") —
  these become cross-shard scatter-gather. Everything today is per-user; keep it
  that way.

#### client-side resilience (defense in depth, not a substitute)

- An active client caches the **unwrapped DEK** locally (IndexedDB, as a
  non-extractable `CryptoKey`), so a transient server hiccup never locks a live
  session. A _fresh_ device still depends entirely on server durability — which
  is why the D1 backup discipline above is non-negotiable.
- Optionally let the user **download their wrapped-DEK blob** as an explicit
  user-held backup file — a last-ditch copy that survives even total server loss
  (still useless without a door's secret, so it stays zero-knowledge).

> Cloudflare references: [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/),
> [D1 export](https://developers.cloudflare.com/d1/wrangler-commands/),
> [D1 limits (10 GB/db, 50k dbs)](https://developers.cloudflare.com/d1/platform/limits/),
> [SQLite-backed DO storage + PITR](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).
> R2 has **no** native object versioning as of 2026-06; keys live in D1 for that
> reason, and bulk R2 data is replicated rather than versioned.

### rollout — adopt the architecture now, ship doors later

The architecture is the decision; the doors are incremental. Doing the DEK
indirection **before real users exist** is the whole point — afterwards, adding
it is a re-key migration of every account.

- **Phase 0 — now, pre-launch.** Make the root a random DEK with a **single
  password door**. UX is identical to direct derivation, but every later door is
  additive (wrap another copy of the DEK), not a migration.
- **Phase 1 — launch.** Add the generated **recovery code** as a second door.
  Weak-ish alone (people misplace codes), but its failure mode is independent of
  forgetting a password, so it still cuts catastrophic loss.
- **Phase 2 — later.** Add the **passkey (PRF)** door where supported — the
  platform-synced, per-device door that actually survives.

Messaging shifts from "don't lose your password" to **"lose _all_ your doors and
the data is gone."**

### open items before launch

- **DEK indirection (Phase 0)** — adopt the random-DEK root + password door
  _before_ the first real user; it's free now and a migration later.
- **`APP_SALT`** — ✅ set to a real 256-bit high-entropy constant
  (`crypto/params.ts`, `brace.app-salt.v1.…`). It can never change after the
  first real user; a hypothetical rotation mints a `.v2.` constant rather than
  editing it.
- **Entropy gate** — add the strength meter + hard floor described above.
- **Generated passphrase** — build the default-generate flow.
- **No-recovery messaging** — make the "lose all your doors = lose the data"
  consequence explicit in the create-account UI.
- **Server credential + key storage and signature verification** — the storage
  side is **✅ built**: `createAccount` claims the username in `DIRECTORY_DB`,
  writes `users.public_key` + `account_keys` (wrapped DEK inline) atomically in
  the shard, and releases the claim on failure (`services/account.ts`). Still
  open: the **shared create-account contract** carrying `publicKey` + door blobs
  (no route calls `createAccount` yet), the **load-bearing sign-in check** (verify
  signature, then match against the stored key — see [the two
  identifiers](#the-two-identifiers)), and the **orphan-claim sweeper** (reclaim
  claims with no backing `users` row, alongside `sessions.deleteExpired`).
- **Blob-fetch hardening** — the password-door `wrapped_dek` is served pre-auth
  (it must be), so add **rate-limiting + username-enumeration protection** on that
  path to blunt mass-scraping of the offline-attack oracle. Not a substitute for
  the entropy gate — see [why the wrapped DEK is served
  pre-auth](#why-the-wrapped-dek-is-served-pre-auth--the-offline-attack-surface).
- **Recovery code (Phase 1) / passkey PRF (Phase 2)** — additional doors, added
  by wrapping the DEK; no derivation-contract change.
- **OPAQUE password door (future, optional)** — the documented upgrade path if
  online-only (or KMS-isolated breach-resistant) password protection becomes a
  requirement; swap the password door's KEK for OPAQUE's `export_key` in isolation
  — no DEK/data/other-door change. Skip the naive KEK-signature half-measure.
- **Storage durability** — schema/topology is **✅ built**: three databases
  (`DIRECTORY_DB`, `ACCOUNTS_DB_1`, `SESSIONS_DB`), `account_keys` with the
  **wrapped DEK inline** in the shard, and the `account_db_id` routing seam. Still
  open (don't wait for the first real user): the daily export + off-platform copy
  for `DIRECTORY_DB` **and** each account shard (the two together are the Tier-0
  set), and a restore drill.
