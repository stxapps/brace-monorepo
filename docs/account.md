## account & key derivation

How a brace account works: there is **no account on the server** in the
traditional sense — the user's `(username, password)` pair _is_ the account.
From it the client deterministically derives every key it needs. See
[architecture.md](./architecture.md) for package layering,
[api-contracts.md](./api-contracts.md) for how the create-account endpoint is
typed, and [local-first-sync.md](./local-first-sync.md) for what the derived
encryption key protects. The crypto implementation lives in
`@stxapps/web-crypto`; the frozen parameters and validators live in
`@stxapps/shared` (`crypto/params.ts`, `auth/credentials.ts`).

### the model: a password-derived wallet

brace is a **zero-knowledge** bookmark manager. The server stores only
ciphertext and never sees the password, the master secret, or any private key.
That makes the account model structurally identical to a **crypto wallet**:

- the secret **is** the account — no email, no server-side password reset;
- keys are derived **deterministically** from the secret, the same way every
  time, on every device;
- **there is no recovery.** Lose the password and the data is gone, exactly like
  losing a wallet seed phrase. This must be communicated clearly in the UI.

The one place it differs from a wallet is the part that matters most — **where
the entropy comes from** — and that difference drives every rule below.

|                     | 24-word seed (BIP-39)         | brace `(username, password)`                                |
| ------------------- | ----------------------------- | ----------------------------------------------------------- |
| entropy source      | **forced random** (~256 bits) | **user-chosen** — whatever they pick                        |
| offline brute force | infeasible, period            | feasible **if the password is weak**                        |
| per-guess cost      | —                             | Argon2id (64 MiB, ~1–3s) — raises cost, **adds no entropy** |
| recovery            | none                          | none                                                        |

A wallet _forces_ high entropy; brace _trusts the user_ to choose it. Argon2id
(memory-hard) makes each guess expensive — this is what defeated the old
SHA-256 "brain wallets" that got drained — and the per-user salt stops shared
rainbow tables. But neither manufactures entropy: **the security of an account
is bounded by the entropy of its password.** A generated 6-word passphrase
approaches wallet-grade; `Summer2026!` does not.

> The product goal is _wallet-grade safety with better UX_ — users pick their
> own username and password instead of memorizing a random seed. That only holds
> if we steer them toward enough password entropy (see [generated
> password](#generated-password-recommended-default) below). UX convenience must
> not quietly become a weak-key generator.

### the derivation pipeline

One synchronous pass, run once at sign-in / create-account inside a Web Worker
(Argon2id is ~1–3 s of CPU, kept off the main thread):

```
(username, password)
        │
        │  salt = SHA-256(APP_SALT ‖ canonicalUsername)   ← per-user salt
        ▼
   Argon2id(password, salt)  ──▶  master secret (32 bytes)
        │
        ├─ HKDF(info="brace-auth-seed") ──▶ Ed25519 keypair
        │                                     ├─ publicKey  (credential, sent)
        │                                     └─ sign()     (private key, never leaves the module)
        │
        └─ HKDF(info="brace-encryption-key") ──▶ AES-256-GCM key (non-extractable, never sent)
```

- **Per-user salt** — `SHA-256(APP_SALT ‖ canonicalizeUsername(username))`.
  Folding the unique username in means two users who pick the _same_ password
  still derive different keys, with nothing stored server-side (any client
  recomputes it from `(username, password)` alone). `APP_SALT` is the app-wide
  domain separator that defends against precomputed tables shared across apps.
  The username is a **public, deterministic** salt: it de-duplicates passwords
  but does not hide a targeted user, so the real cost against a focused attacker
  is Argon2id's memory-hardness, not the salt.
- **`master secret`** never leaves `@stxapps/web-crypto`; only the two derived
  sub-keys (and the public key / signatures) are used outside it.
- **`publicKey`** is the Ed25519 public key (hex). It is a **credential**, not an
  identifier — see [the two identifiers](#the-two-identifiers) below.

These parameters are a **frozen cross-platform contract** in
`crypto/params.ts`: web, extension, and the future Expo client must all derive
with the exact same `APP_SALT`, `ARGON2_PARAMS`, HKDF labels, and
`canonicalizeUsername` rule, or the same password produces different keys and
the user is locked out of their data. **They can never change once real users
exist.**

### username — rules and why

Defined once in `auth/credentials.ts` (`usernameSchema`) and enforced
identically on the form and the server:

| rule             | value                     | why                                                         |
| ---------------- | ------------------------- | ----------------------------------------------------------- |
| length           | **3–32** chars            | short enough to type, long enough to be distinct            |
| charset          | `[a-zA-Z0-9_]`            | unambiguous, URL-safe, no Unicode confusables in the handle |
| canonicalization | `trim → NFKC → lowercase` | one deterministic form (`canonicalizeUsername`)             |

The username does double duty: it is the **public handle** (the server's
case-insensitive `UNIQUE` key) _and_ the **per-user salt input**. Because it is
folded into key derivation, the canonicalization rule is part of the frozen
contract and the username is **effectively permanent** — changing it would
re-derive every key and re-key all data. Treat a rename as "create a new account
and migrate," not an editable profile field.

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
- the words are just a high-entropy `password` — they flow through the exact
  same pipeline above, so **no derivation changes are needed**, only UI.

This keeps the promise: a user _can_ pick their own username and password (good
UX), but the **safe path is the default path** (wallet-grade entropy), rather
than relying on every user to invent a strong secret.

### the two identifiers

A common source of confusion: an account has **one identifier and one
credential**, not "two ids."

| name        | what it is                                                                                                                       | derived/stored where                                       | sent to server?        |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------- |
| `userId`    | the account's **stable primary key** — random, server-minted (`newId()`); also the Durable Object address (`idFromName(userId)`) | brace-api `users` table                                    | issued _by_ the server |
| `publicKey` | the **credential** — Ed25519 public key the server verifies signatures against                                                   | derived on the client; stored as a `users.public_key` column | yes (it's public)      |

Why keep a separate random `userId` instead of using the `publicKey` as the id:

- **rotation** — changing the password changes the `publicKey`; a stable
  `userId` lets the credential change without re-addressing the DO or rewriting
  every foreign key. (For the same reason, `public_key` is **never denormalized
  into `sessions`** the way `user_id` is — `user_id` is immutable and read on
  every request; `public_key` is mutable and read only at sign-in.)
- **no credential leakage** — keeping a separate id means the public key lives
  in exactly one place rather than being sprinkled across sessions, op-logs, and
  every reference.

`publicKey` is stored as a **column on `users`**, not in a separate 1:N
`credentials` table. The multi-credential future a credentials table would buy
(recovery key, per-device key, passkey) **does not apply here**, because the
encryption key is derived _directly_ from `(username, password)` — there is only
one door to the data, exactly like a wallet seed (see [the
model](#the-model-a-password-derived-wallet)). A passkey or per-device key could
authenticate to the server but still couldn't _decrypt_ anything, and device
revocation is already handled by deleting the device's `sessions` row. Adding
real recovery would mean switching to a random data-key wrapped by multiple
key-encryption-keys — its own new storage either way, which a `credentials`
table would neither enable nor block. So one column, one credential.

So: identify by `userId` (and the human-facing `username`), **authenticate** by
a signature the `publicKey` verifies. The client proves ownership by signing a
timestamped `{ publicKey, username, action, timestamp }` payload with the
Ed25519 private key at create-account / sign-in.

> **The load-bearing sign-in check.** The server **cannot** verify that a
> keypair was honestly derived from `(username, password)` — a client can sign a
> valid payload with _any_ keypair and _any_ username. That is fine, but only if
> the server, on sign-in, checks the presented `publicKey` against the
> **stored** `users.public_key` for that username — not merely that the
> signature is internally valid for the publicKey in the payload. Skipping that
> comparison would let anyone "sign in" with their own key. So the server must:
> (1) verify the signature against `payload.publicKey` (proof of possession);
> (2) confirm `payload.publicKey === users.public_key` for `payload.username`;
> (3) check `action` and a fresh `timestamp` (context + replay binding). On
> create-account there is no stored key yet, so step 2 is replaced by the
> `username` UNIQUE check, and the presented `publicKey` is what gets stored.

> **STATUS — partially built:** the client derives `publicKey` and signs the
> payload (`use-create-account.ts`); the server side that stores it (the
> `users.public_key` column) and runs the sign-in check above is **not
> implemented yet** — see the TODOs in `apps/brace-api/src/services/account.ts`
> and [api-contracts.md](./api-contracts.md).

### open items before launch

- **`APP_SALT`** is still a placeholder (`crypto/params.ts`) — replace with a
  real high-entropy constant before the first real user; it can never change
  after.
- **Entropy gate** — add the strength meter + hard floor described above.
- **Generated passphrase** — build the default-generate flow.
- **No-recovery messaging** — make the "lose the password = lose the data"
  consequence explicit in the create-account UI, the way wallets warn about seed
  phrases.
- **Server credential storage + signature verification** — store the
  `publicKey` on create-account (`users.public_key`) and run the load-bearing
  sign-in check (verify signature, then match against the stored key — see [the
  two identifiers](#the-two-identifiers)).
