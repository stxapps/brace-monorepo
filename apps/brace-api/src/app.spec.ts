import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import {
  bytesToHex,
  checkUsernameEndpoint,
  passwordDoorEndpoint,
  signInEndpoint,
  signOutEndpoint,
} from '@stxapps/shared';

import { sessionsRepo } from './db/repositories/sessions';
import { usernamesRepo } from './db/repositories/usernames';
import { hashToken } from './lib/ids';
import { createAccount } from './services/account';
import { issueSession } from './services/session';
import { app } from './app';

// Build request URLs from the shared contract path so these stay correct across
// version-prefix changes (e.g. /v1 → /v2) without editing every literal here.
const usernamePath = checkUsernameEndpoint.path;

// app.request(path, init, env) — the third arg is the bindings the handlers see.
// Under vitest-pool-workers `env` is the REAL local Workers env (D1/R2/DO/rate
// limits), so the username routes that query DIRECTORY_DB actually run. Storage
// is isolated per test (see vitest.config.ts) and seeded with migrations only.
describe('brace-api', () => {
  it('returns a welcome message on the root route', async () => {
    const res = await app.request('/', {}, env);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      message: 'Welcome to brace-api',
    });
  });

  it('reports a healthy status', async () => {
    const res = await app.request('/health', {}, env);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: 'ok' });
  });

  describe(`GET ${checkUsernameEndpoint.path}`, () => {
    it('reports an available username', async () => {
      const res = await app.request(`${usernamePath}?username=freshname`, {}, env);

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ available: true });
    });

    it('reports a taken username, case-insensitively', async () => {
      // Seed the directory with the canonical (lowercase) form, then query a
      // different-cased spelling: the lookup canonicalizes, so 'Admin' must
      // resolve to the stored 'admin' and report unavailable.
      await usernamesRepo(env.DIRECTORY_DB).claim({
        username: 'admin',
        userId: 'u_seed',
        accountDbId: '1',
      });

      const res = await app.request(`${usernamePath}?username=Admin`, {}, env);

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ available: false });
    });

    // This one needs no DB: it fails at the zValidator (shared schema) before the
    // handler ever touches a binding.
    it('rejects a username that fails the shared validation rules', async () => {
      const res = await app.request(`${usernamePath}?username=no`, {}, env);

      expect(res.status).toBe(400);
    });
  });

  // Generate a REAL Ed25519 keypair in the Workers runtime (workerd has Web Crypto
  // Ed25519), seed an account holding its publicKey + a password door, and return
  // what a sign-in needs. This exercises the actual signature path + the
  // load-bearing publicKey comparison without importing the client crypto lib
  // (@stxapps/web-crypto is platform:web; brace-api is platform:worker).
  async function newKeyPair(): Promise<{ keyPair: CryptoKeyPair; publicKey: string }> {
    const keyPair = (await crypto.subtle.generateKey('Ed25519', true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
    return { keyPair, publicKey: bytesToHex(raw) };
  }

  async function sign(keyPair: CryptoKeyPair, payload: string): Promise<string> {
    const sig = await crypto.subtle.sign('Ed25519', keyPair.privateKey, new TextEncoder().encode(payload));
    return bytesToHex(new Uint8Array(sig));
  }

  // A realistic password door: a 48-byte wrapped DEK (32-byte DEK + 16-byte GCM
  // tag) and a 12-byte IV. The bytes are filler — the server stores and echoes them
  // opaquely; only the client ever unwraps.
  const door = { wrappedDek: new Uint8Array(48).fill(7), iv: new Uint8Array(12).fill(9) };

  async function seedAccount(username: string): Promise<{ keyPair: CryptoKeyPair; publicKey: string }> {
    const kp = await newKeyPair();
    await createAccount(env, {
      username,
      publicKey: kp.publicKey,
      doors: [{ doorType: 'password', ...door }],
    });
    return kp;
  }

  describe(`GET ${passwordDoorEndpoint.path}`, () => {
    it('returns the password door blob for an existing account', async () => {
      await seedAccount('doorholder');

      const res = await app.request(`${passwordDoorEndpoint.path}?username=doorholder`, {}, env);

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        wrappedDek: bytesToHex(door.wrappedDek),
        iv: bytesToHex(door.iv),
      });
    });

    it('returns 404 for an unknown username', async () => {
      const res = await app.request(`${passwordDoorEndpoint.path}?username=ghostuser`, {}, env);

      expect(res.status).toBe(404);
    });

    it('rejects a malformed username at the contract boundary', async () => {
      const res = await app.request(`${passwordDoorEndpoint.path}?username=no`, {}, env);

      expect(res.status).toBe(400);
    });
  });

  describe(`POST ${signInEndpoint.path}`, () => {
    const body = (payload: string, signature: string) => ({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload, signature }),
    });

    it('issues a session for a valid proof matching the stored credential', async () => {
      const { keyPair, publicKey } = await seedAccount('validsigner');
      const payload = JSON.stringify({
        action: 'sign-in',
        username: 'validsigner',
        publicKey,
        timestamp: Date.now(),
      });

      const res = await app.request(signInEndpoint.path, body(payload, await sign(keyPair, payload)), env);

      expect(res.status).toBe(200);
      const json = (await res.json()) as { token: string; expiresAt: number };
      expect(typeof json.token).toBe('string');
      expect(typeof json.expiresAt).toBe('number');
      // The session is real — resolvable by token hash, exactly what the auth guard reads.
      expect(await sessionsRepo(env.SESSIONS_DB).findByTokenHash(await hashToken(json.token))).not.toBeNull();
    });

    it('rejects a valid proof for an unknown username with an opaque 401', async () => {
      const { keyPair, publicKey } = await newKeyPair();
      const payload = JSON.stringify({
        action: 'sign-in',
        username: 'noaccount',
        publicKey,
        timestamp: Date.now(),
      });

      const res = await app.request(signInEndpoint.path, body(payload, await sign(keyPair, payload)), env);

      expect(res.status).toBe(401);
    });

    it('rejects a valid signature whose key is not the stored credential', async () => {
      // Seed under one key, then sign with a DIFFERENT key and present it in the
      // payload. The signature is internally valid, so this isolates THE
      // load-bearing check: the presented key ≠ stored credential ⇒ 401.
      await seedAccount('keymismatch');
      const other = await newKeyPair();
      const payload = JSON.stringify({
        action: 'sign-in',
        username: 'keymismatch',
        publicKey: other.publicKey,
        timestamp: Date.now(),
      });

      const res = await app.request(signInEndpoint.path, body(payload, await sign(other.keyPair, payload)), env);

      expect(res.status).toBe(401);
    });

    it('rejects a create-account proof replayed at sign-in (action mismatch)', async () => {
      const { keyPair, publicKey } = await seedAccount('replayer');
      // action 'create-account' fails signInPayloadSchema's z.literal('sign-in')
      // inside verifyAuthProof → 400, never reaching the credential lookup.
      const payload = JSON.stringify({
        action: 'create-account',
        username: 'replayer',
        publicKey,
        timestamp: Date.now(),
      });

      const res = await app.request(signInEndpoint.path, body(payload, await sign(keyPair, payload)), env);

      expect(res.status).toBe(400);
    });
  });

  describe(`POST ${signOutEndpoint.path}`, () => {
    // The real client sends an empty JSON body — the session to revoke is named by
    // the bearer token, not the body — so mirror that here.
    const post = (headers: Record<string, string>) =>
      app.request(
        signOutEndpoint.path,
        { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' },
        env,
      );

    it('revokes the session for a valid bearer token', async () => {
      // Mint a real session, then confirm it resolves BEFORE sign-out so the
      // post-condition (it's gone) is meaningful rather than vacuously true.
      const { token } = await issueSession(env, { id: 'u_signout', accountDbId: '1' });
      const tokenHash = await hashToken(token);
      expect(await sessionsRepo(env.SESSIONS_DB).findByTokenHash(tokenHash)).not.toBeNull();

      const res = await post({ authorization: `Bearer ${token}` });

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ ok: true });
      // The row is deleted, so the same token no longer authenticates — exactly
      // what the auth guard checks on the next request.
      expect(await sessionsRepo(env.SESSIONS_DB).findByTokenHash(tokenHash)).toBeNull();
    });

    it('rejects a request with no bearer token', async () => {
      const res = await post({});

      expect(res.status).toBe(401);
    });

    it('rejects an unknown bearer token', async () => {
      const res = await post({ authorization: 'Bearer not-a-real-token' });

      expect(res.status).toBe(401);
    });
  });
});
