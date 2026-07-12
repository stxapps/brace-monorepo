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
import { createAccount, unlockAccount, WrongPasswordError } from './derive';

// Argon2id at the frozen params (64 MiB, t=3) runs a few times in this suite.
jest.setTimeout(120_000);

beforeAll(() => setArgon2Runner('main'));

const door = {
  wrappedDek: hexToBytes(V.passwordDoor.wrappedDekHex),
  iv: hexToBytes(V.passwordDoor.ivHex),
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
});
