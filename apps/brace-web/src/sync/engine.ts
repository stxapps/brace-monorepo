'use client';

// Hand-rolled sync engine — layer 2 in docs/local-first-sync.md. Runs at the
// app/background level, NOT in React (no hooks): it talks to the Hono API through
// the shared contract client (`callEndpoint`) and to R2 over fetch, doing the
// crypto boundary (encrypt before PUT / decrypt after GET) with
// @stxapps/web-crypto. Results land in the Dexie store (db.ts), which the UI
// observes reactively — so there is nothing for a query cache to hold.
//
// STUBBED SEAM. The signatures and call sites are real (SyncProvider drives
// these); the bodies are placeholders so the gate/provider/screen can be wired
// and exercised before the transport exists. Fill in against the op-log
// endpoints (apps/brace-api/.../op-logs.ts `listSince`) when building the
// transport.

import { advanceCursor, getSyncMeta, markFirstSyncDone } from '../data/sync-store';

// TODO: can be in lib/? no need a specific folder for sync?

// TODO: verify no need username?
//   no need encryptionKey as session-store already store it?
export interface SyncContext {
  username: string;
  // Non-extractable AES key from the session store; used to decrypt R2 blobs.
  // Read by the caller via getSession() and passed in so the engine stays free
  // of session/auth imports.
  encryptionKey: CryptoKey;
}

// First sync after a fresh sign-in on this device. Pull the full manifest from
// seq 0, download every blob, decrypt, write to db.links — then mark done.
// BLOCKING from the UI's point of view (SyncGate shows the decrypting screen
// until this resolves).
export async function runInitialSync(ctx: SyncContext): Promise<void> {
  // TODO: loop callEndpoint(syncPullEndpoint, { since }) advancing `since` to the
  // max seq returned while a full page comes back; for each op, GET the R2 blob,
  // decrypt with ctx.encryptionKey, and db.links.put(...). Track the final seq.
  const lastSeq = 0;
  await markFirstSyncDone(ctx.username, lastSeq);
}

// Incremental sync on a returning visit (and after the app is already rendering
// local data). Pull ops after the stored cursor, apply, advance. Non-blocking:
// failures here surface a quiet retry indicator, they don't gate the UI.
export async function runIncrementalSync(ctx: SyncContext): Promise<void> {
  const meta = await getSyncMeta(ctx.username);
  const since = meta?.lastSeq ?? 0;
  // TODO: same pull loop as above, starting from `since`; on each applied batch
  // advanceCursor(ctx.username, maxSeq).
  void since;
  await advanceCursor(ctx.username, since);
}
