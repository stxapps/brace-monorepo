// Frozen-contract spec: asserts this platform's implementation against the
// golden vectors in @stxapps/shared (crypto/contract-vectors.ts) — the same vectors
// web-crypto asserts — so "web and native derive identical keys" is CI-proven.
// quick-crypto is shimmed onto Node primitives (see ../testing), so what's
// under test is OUR mapping/wire-format code, not the native library.
import {
  BLOB_FORMAT_V1,
  bytesToHex,
  CRYPTO_CONTRACT_VECTOR as V,
  deriveUserSalt,
  hexToBytes,
  utf8,
} from '@stxapps/shared';

import { decrypt, encrypt } from './aes';
import { deriveArgon2Hash } from './argon2';
import { decryptEntity } from './blob';
import { createAccount, unlockAccount, WrongPasswordError } from './derive';

// Argon2id at the frozen params (64 MiB, t=3) runs a few times in this suite.
jest.setTimeout(120_000);

const door = {
  wrappedDek: hexToBytes(V.passwordDoor.wrappedDekHex),
  iv: hexToBytes(V.passwordDoor.ivHex),
};

describe('frozen-contract vectors', () => {
  it('derives the contract password-KEK (salt + Argon2id param mapping)', async () => {
    const salt = deriveUserSalt(V.username);
    expect(bytesToHex(salt)).toBe(V.saltHex);

    const kek = await deriveArgon2Hash(V.password, salt);
    expect(bytesToHex(kek)).toBe(V.kekHex);
  });

  it('unlocks the contract account through the password door', async () => {
    const account = await unlockAccount(V.username, V.password, door);

    expect(account.publicKey).toBe(V.publicKeyHex);
    expect(bytesToHex(account.encryptionKey)).toBe(V.encryptionKeyHex);
    await expect(account.sign(V.signPayload)).resolves.toBe(V.signatureHex);
  });

  it('rejects a wrong password as WrongPasswordError', async () => {
    await expect(unlockAccount(V.username, 'not the password', door)).rejects.toBeInstanceOf(
      WrongPasswordError,
    );
  });

  it('decrypts the packed v1 contract blob', async () => {
    const packed = hexToBytes(V.blob.packedHex);
    expect(packed[0]).toBe(BLOB_FORMAT_V1);

    // Decrypt through the real framer (unpackBlob, inside decryptEntity) so the
    // golden vector pins the actual wire-format code, not a hand-inlined slice.
    const plaintext = await decryptEntity(hexToBytes(V.encryptionKeyHex), packed);
    expect(new TextDecoder().decode(plaintext)).toBe(V.blob.plaintext);
  });
});

describe('roundtrips', () => {
  it('createAccount mints a door its own unlockAccount opens', async () => {
    const created = await createAccount(V.username, V.password);
    const unlocked = await unlockAccount(V.username, V.password, created.passwordDoor);

    expect(unlocked.publicKey).toBe(created.publicKey);
    expect(bytesToHex(unlocked.encryptionKey)).toBe(bytesToHex(created.encryptionKey));
  });

  it('AES-GCM roundtrips and binds the AAD', async () => {
    const key = hexToBytes(V.encryptionKeyHex);
    const data = utf8('some entity bytes');

    const blob = await encrypt(key, data, utf8('ctx'));
    await expect(decrypt(key, blob, utf8('ctx'))).resolves.toEqual(data);
    await expect(decrypt(key, blob, utf8('other'))).rejects.toThrow();
    await expect(decrypt(key, blob)).rejects.toThrow();
  });
});
