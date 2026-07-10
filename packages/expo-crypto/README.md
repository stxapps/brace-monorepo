# @stxapps/expo-crypto

The Expo/native sibling of `@stxapps/web-crypto` (`type:crypto`,
`platform:expo`): the same account derivation pipeline and AES-256-GCM
primitives, implemented on React Native.

- **Heavy compute runs native.** Argon2id, HKDF, and AES-GCM go through
  `react-native-quick-crypto` (C++ JSI/Nitro). Ed25519 stays on
  `@noble/ed25519` — the exact library web uses — because signing is
  microseconds and sharing the implementation makes credential drift
  structurally impossible.
- **File-level encryption never enters JS.** The bundled `BraceFileCrypto`
  Expo native module (`ios/`, `android/`) encrypts/decrypts whole files
  path-to-path in the native layer, producing the frozen v1 blob frame
  `[0x01 || iv(12) || ciphertext+tag]` — byte-compatible with the blobs the
  web client packs/unpacks in JS.
- **The frozen contract lives in `@stxapps/shared`** (`crypto/params.ts`,
  `salt.ts`, `doors.ts`): APP_SALT, ARGON2_PARAMS, HKDF labels, the blob
  frame constants. This package only implements them; specs assert the
  golden vectors from `@stxapps/shared` so web and native can never diverge.

Requires a dev client / `expo prebuild` (native code — not Expo Go).
