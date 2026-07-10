// Golden test vectors for the FROZEN cross-platform crypto contract (see
// params.ts / salt.ts / doors.ts and docs/account.md). Every platform
// implementation — @stxapps/web-crypto (web/extension) and @stxapps/expo-crypto
// (Expo/native) — asserts these same values in its specs, so "web and native
// derive identical keys" is CI-proven, not a review promise.
//
// TEST FIXTURE ONLY — nothing here is a secret and nothing here is used at
// runtime. The values were produced by the real web-crypto pipeline
// (hash-wasm Argon2id + Web Crypto HKDF/AES-GCM + @noble/ed25519), with the
// account proven end-to-end through unlockAccount. The DEK and IVs are FIXED so
// the derived values are reproducible; real accounts mint them from a CSPRNG.
//
// Like the parameters they pin, these values can never change: a differing
// output on any platform means that platform locks users out of their data.

export const CRYPTO_CONTRACT_VECTOR = {
  username: 'Alice_01',
  password: 'correct horse battery staple',

  // deriveUserSalt(username) = SHA-256(APP_SALT ‖ canonical username)
  saltHex: 'bd91cb5d7124594b159f5a50ac1f162ef5d38813fefb80c500603dd42a21c29b',

  // password-KEK = Argon2id(password, salt) under ARGON2_PARAMS
  kekHex: 'cef7ac6becd5218faa34c09b30ca36fd61ea21451c453958ef734dd18a3beb10',

  // The fixed account root for this vector (real DEKs are random).
  dekHex: '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',

  // HKDF(DEK, info=HKDF_INFO_AUTH_SEED / HKDF_INFO_ENCRYPTION_KEY), empty salt.
  authSeedHex: '32c641d42a6dbf6926509c59eac28047992cd1054aa891230592a47bc938dfc7',
  encryptionKeyHex: 'f9d0c6154768545033a6684da3dc089ec38e0cf83a4d5396aba1fe93af9ff009',

  // Ed25519 public key derived from authSeed — what the server stores as the
  // credential — and a deterministic signature over signPayload.
  publicKeyHex: '2438e65203747dc74929559f5de79ec2402e3a2694086d9845c7564b6a308646',
  signPayload: 'brace-contract-test-payload',
  signatureHex:
    '7b556650a49b4d37a50a26f7c92bab710a0b0b44570ff9421a84fc809381c0bc' +
    'edca1af3ab2cf70b9467161278b44160704459278f9512ff930bb67da9041005',

  // The password door: AES-256-GCM(KEK, DEK, aad = dekWrapAad('password')) with
  // this fixed IV — an `account_keys` row. wrappedDek includes the 16-byte tag.
  passwordDoor: {
    ivHex: 'a0a1a2a3a4a5a6a7a8a9aaab',
    wrappedDekHex:
      '020ee9b1c60569b4ec64dff74c1bf9f9ad9f8c0a0329299d1e84e4273ff271f8' +
      '9a2b1f5bf9eddb75a0a70ef6411483e2',
  },

  // A packed v1 sync blob `[BLOB_FORMAT_V1 || iv || ciphertext+tag]` of
  // blobPlaintext (utf-8) under encryptionKeyHex, no AAD — exactly what a
  // client uploads to R2 and what the native file module must produce/consume.
  blob: {
    ivHex: 'b0b1b2b3b4b5b6b7b8b9babb',
    plaintext: 'Hello, brace! contract vector v1',
    packedHex:
      '01b0b1b2b3b4b5b6b7b8b9babb13e7e3b68ff54d17c55938b709b8364b7ab717' +
      '31d80efe746edfe626068bd5bc4f6b9be76cee6793525fa729ac7ffdea',
  },
} as const;
