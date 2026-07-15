/**
 * @jest-environment node
 *
 * Frozen-contract spec: asserts the web implementation against the golden
 * vectors in @stxapps/shared (crypto/contract-vectors.ts) — the same vectors
 * @stxapps/expo-crypto asserts — so "web and native derive identical keys" is
 * CI-proven. Node env: the real Web Crypto lives at globalThis.crypto there,
 * and hash-wasm runs inline via the 'main' Argon2 runner (no Workers in jest).
 */
import {
  BLOB_FORMAT_V1,
  bytesToHex,
  CRYPTO_CONTRACT_VECTOR as V,
  deriveUserSalt,
  hexToBytes,
} from '@stxapps/shared';

import { deriveArgon2Hash, setArgon2Runner } from './argon2';
import { decryptEntity } from './blob';
import {
  createAccount,
  regenerateRecoveryDoor,
  unlockAccount,
  unlockAccountWithRecovery,
  WrongPasswordError,
  WrongRecoveryCodeError,
} from './derive';

// Argon2id at the frozen params (64 MiB, t=3) runs a few times in this suite.
jest.setTimeout(120_000);

beforeAll(() => setArgon2Runner('main'));

const door = {
  wrappedDek: hexToBytes(V.passwordDoor.wrappedDekHex),
  iv: hexToBytes(V.passwordDoor.ivHex),
};

const recoveryDoor = {
  wrappedDek: hexToBytes(V.recovery.wrappedDekHex),
  iv: hexToBytes(V.recovery.ivHex),
};

describe('frozen-contract vectors', () => {
  it('derives the contract password-KEK (salt + Argon2id)', async () => {
    const salt = deriveUserSalt(V.username);
    expect(bytesToHex(salt)).toBe(V.saltHex);

    const kek = await deriveArgon2Hash(V.password, salt);
    expect(bytesToHex(new Uint8Array(kek))).toBe(V.kekHex);
  });

  it('unlocks the contract account through the password door', async () => {
    const account = await unlockAccount(V.username, V.password, door);

    expect(account.publicKey).toBe(V.publicKeyHex);
    await expect(account.sign(V.signPayload)).resolves.toBe(V.signatureHex);

    // encryptionKey is a non-extractable CryptoKey, so prove it by USE: it must
    // decrypt the packed v1 contract blob (encrypted under the vector's raw
    // encryptionKeyHex). Decrypt through the real framer (unpackBlob, inside
    // decryptEntity) so the golden vector pins the actual wire-format code, not
    // a hand-inlined slice.
    const packed = hexToBytes(V.blob.packedHex);
    expect(packed[0]).toBe(BLOB_FORMAT_V1);
    const plaintext = await decryptEntity(account.encryptionKey, packed);
    expect(new TextDecoder().decode(plaintext)).toBe(V.blob.plaintext);
  });

  it('canonicalizes the password (trim + NFC) so equivalent encodings open one door', async () => {
    // Same-looking password in two Unicode encodings + surrounding whitespace,
    // written as \u escapes so the bytes are unambiguous: precomposed 'é'
    // (U+00E9) at create vs decomposed 'e' + combining acute (U+0301) at unlock.
    // Both must derive one KEK, or a user who set the password on one keyboard is
    // locked out on another (there is no reset).
    const created = await createAccount(V.username, 'café-secret-42');
    const unlocked = await unlockAccount(V.username, '  café-secret-42  ', created.passwordDoor);
    expect(unlocked.publicKey).toBe(created.publicKey);
  });

  it('rejects a wrong password as WrongPasswordError', async () => {
    await expect(unlockAccount(V.username, 'not the password', door)).rejects.toBeInstanceOf(
      WrongPasswordError,
    );
  });

  it('createAccount mints a door its own unlockAccount opens', async () => {
    const created = await createAccount(V.username, V.password);
    const unlocked = await unlockAccount(V.username, V.password, created.passwordDoor);
    expect(unlocked.publicKey).toBe(created.publicKey);
  });

  it('unlocks the same account through the RECOVERY door (identical publicKey)', async () => {
    const account = await unlockAccountWithRecovery(V.recovery.code, recoveryDoor);
    // Same DEK unwrapped by a different door → same derived credential as the
    // password door above.
    expect(account.publicKey).toBe(V.publicKeyHex);
  });

  it('rejects a wrong recovery code as WrongRecoveryCodeError', async () => {
    await expect(
      unlockAccountWithRecovery('00000000000000000000000000000000', recoveryDoor),
    ).rejects.toBeInstanceOf(WrongRecoveryCodeError);
  });

  it('createAccount with a recovery code mints both doors, and either opens the DEK', async () => {
    const code = V.recovery.code;
    const created = await createAccount(V.username, V.password, { recoveryCode: code });
    const recoveryDoor = created.recoveryDoor;
    if (!recoveryDoor) throw new Error('expected a recovery door');

    const viaPassword = await unlockAccount(V.username, V.password, created.passwordDoor);
    const viaRecovery = await unlockAccountWithRecovery(code, recoveryDoor);
    expect(viaRecovery.publicKey).toBe(viaPassword.publicKey);
  });

  it('regenerateRecoveryDoor re-wraps the same DEK under a new code (old code stops working)', async () => {
    const created = await createAccount(V.username, V.password, { recoveryCode: V.recovery.code });
    const newCode = 'ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ';
    const { recoveryDoor: rotated, account } = await regenerateRecoveryDoor(newCode, {
      kind: 'password',
      username: V.username,
      password: V.password,
      door: created.passwordDoor,
    });
    // The returned account is the SAME credential (DEK unchanged).
    expect(account.publicKey).toBe(created.publicKey);

    // New code opens the same account; the original code no longer fits the new blob.
    const viaNew = await unlockAccountWithRecovery(newCode, rotated);
    expect(viaNew.publicKey).toBe(created.publicKey);
    await expect(unlockAccountWithRecovery(V.recovery.code, rotated)).rejects.toBeInstanceOf(
      WrongRecoveryCodeError,
    );
  });
});
