import { APP_SALT, canonicalizeUsername } from '@stxapps/shared';

import { utf8 } from './encoding';

type WorkerResult = { ok: true; hash: Uint8Array } | { ok: false; error: string };

// Per-user Argon2 salt: SHA-256(APP_SALT ‖ canonical username). Folding the
// unique username in means two users who pick the same password still derive
// different keys, without storing anything server-side — any client recomputes
// it from (username, password) alone. SHA-256 gives a fixed 32-byte salt
// (Argon2 needs ≥8) and hides the raw username length/bytes. The username is a
// public, deterministic salt — it de-duplicates identical passwords, but the
// real cost against a targeted attacker is Argon2id's memory-hardness.
async function deriveUserSalt(username: string): Promise<Uint8Array<ArrayBuffer>> {
  const app = utf8(APP_SALT);
  const name = utf8(canonicalizeUsername(username));
  const input = new Uint8Array(app.length + name.length);
  input.set(app, 0);
  input.set(name, app.length);
  const digest = await crypto.subtle.digest('SHA-256', input);
  return new Uint8Array(digest);
}

// Runs Argon2id(password, perUserSalt) in a dedicated worker and resolves the
// 32-byte master secret. The salt is derived here (see deriveUserSalt) and
// handed to the worker, which stays a dumb Argon2id step. The worker URL is
// resolved relative to this module so each consuming bundler (Turbopack for
// brace-web, Vite/wxt for the extension) emits its own worker chunk from the
// package source.
export async function deriveMasterSecret(password: string, username: string): Promise<Uint8Array> {
  const salt = await deriveUserSalt(username);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./argon2.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<WorkerResult>) => {
      const data = event.data;
      worker.terminate();
      if (data.ok) resolve(data.hash);
      else reject(new Error(data.error));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message));
    };
    worker.postMessage({ password, salt });
  });
}
