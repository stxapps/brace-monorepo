import { argon2id } from 'hash-wasm';

import { APP_SALT, ARGON2_PARAMS } from '@stxapps/shared';

import { utf8 } from './encoding';

// Dedicated worker. Argon2id is ~1–3s of synchronous CPU work, so it runs off
// the main thread to keep the UI responsive (the worker WASM can't freeze the
// page). The global is typed loosely (via `globalThis`, not `self`) to avoid
// pulling the conflicting WebWorker lib into a package that compiles against
// DOM.
const ctx = globalThis as unknown as {
  onmessage: ((event: MessageEvent<string>) => void) | null;
  postMessage: (message: unknown) => void;
};

ctx.onmessage = async (event) => {
  try {
    const hash = await argon2id({
      password: event.data,
      salt: utf8(APP_SALT),
      ...ARGON2_PARAMS,
      outputType: 'binary',
    });
    ctx.postMessage({ ok: true, hash });
  } catch (error) {
    ctx.postMessage({ ok: false, error: String(error) });
  }
};
