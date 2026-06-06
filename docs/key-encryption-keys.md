 Why recovery / per-device / passkey collapse here

  The crux is how the encryption key is produced. Brace
  derives it directly: HKDF(Argon2id(password, salt)). Direct
  derivation means there is exactly one source of the
  decryption key — the password. That is precisely the
  brain-wallet / seed-phrase model: one secret in, lose it and
  the data is unrecoverable. So:

  - Recovery key — impossible as long as derivation is direct.
  There's no second door to the encryption key because the
  key isn't stored anywhere to put a second lock on — it's
  recomputed from the password each time.
  - Per-device key — you could mint one at the auth layer, but
  it's pointless: the device still can't decrypt until the
  user types the password (which re-derives both keys anyway).
  And device revocation you already get for free by deleting
  that device's session row — no per-device keypair needed.
  - Passkey — authenticates you to the server, but a WebAuthn
  credential can't decrypt your data, so it doesn't fit "the
  secret is the account."

  So under the current architecture, yes — the 
  multi-credential future the doc imagines is largely moot,
  and the only structural reason for a 1:N credentials table
  disappears.

  One honest caveat (doesn't change your conclusion)

  These features aren't fundamentally impossible in E2E — the
  standard escape hatch (1Password, iCloud Keychain, MetaMask)
  is to stop deriving the key directly and instead use a
  random data key wrapped by multiple key-encryption-keys (one
  from the password, one from a recovery code, one from a
  passkey's PRF). Either wrapper unlocks the same data key.

  that switch needs new storage for the 
  wrapped-key blobs
