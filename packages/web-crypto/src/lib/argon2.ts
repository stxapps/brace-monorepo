type WorkerResult = { ok: true; hash: Uint8Array } | { ok: false; error: string };

// Runs Argon2id(passphrase, APP_SALT) in a dedicated worker and resolves the
// 32-byte master secret. The worker URL is resolved relative to this module so
// each consuming bundler (Turbopack for brace-web, Vite/wxt for the extension)
// emits its own worker chunk from the package source.
export function deriveMasterSecret(passphrase: string): Promise<Uint8Array> {
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
    worker.postMessage(passphrase);
  });
}
