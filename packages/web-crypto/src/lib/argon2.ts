type WorkerResult = { ok: true; hash: Uint8Array } | { ok: false; error: string };

// Runs Argon2id(password, salt) in a dedicated worker and resolves the 32-byte
// password-KEK. This is the thin, web-specific KDF step: the per-user salt is
// computed by the caller (derivePasswordKek, via `deriveUserSalt` in
// @stxapps/shared) and handed in ready-to-use, so this and the worker stay a
// dumb Argon2id step with no knowledge of how the salt is built — the future
// native client reuses the same salt and only swaps this Argon2id call. The
// worker URL is resolved relative to this module so each consuming bundler
// (Turbopack for brace-web, Vite/wxt for the extension) emits its own worker
// chunk from the package source.
export async function deriveMasterSecret(password: string, salt: Uint8Array): Promise<Uint8Array> {
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
