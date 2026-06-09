'use client';

// Read/write helpers over the per-account sync bookkeeping row (see db.ts). This
// is the seam the SyncProvider and the sync engine both go through, so the gate
// invariant ("firstSyncDoneAt > 0 ⇒ local store is complete up to lastSeq") has
// one owner. Deliberately tiny and side-effect-light — no network, no React.

// TODO: Should create and use separate IndexedDB db for syncMeta like session-store for session?
import { db, type SyncMetaRecord } from './db';

export type { SyncMetaRecord } from './db';

// The bookkeeping row for an account, or undefined if this device has never
// synced (nor created) it.
export function getSyncMeta(username: string): Promise<SyncMetaRecord | undefined> {
  return db.syncMeta.get(username);
}

// Has the blocking first sync completed for this account on this device? Drives
// SyncGate: true → render local data + sync in background; false → block on a
// full pull. Absent row counts as not-done.
export async function isFirstSyncDone(username: string): Promise<boolean> {
  const meta = await getSyncMeta(username);
  return !!meta && meta.firstSyncDoneAt > 0;
}

// Account-creation path: there is NO server data to pull (a brand-new account is
// empty by definition), so we mark the first sync done immediately with an empty
// cursor. This is what lets create-account render the app instantly with no
// network round-trip — the create-account hook calls this alongside setSession.
// Encoding "new account" as a persisted flag here (rather than threading a
// create-vs-sign-in boolean through React) keeps SyncProvider's logic uniform.
export function seedNewAccount(username: string): Promise<string> {
  return db.syncMeta.put({ username, lastSeq: 0, firstSyncDoneAt: Date.now() });
}

// Sign-in path: call once the initial full pull has finished (all blobs
// downloaded, decrypted, written). Atomic on purpose — only flip the flag after
// the snapshot is complete, so an interrupted first sync stays "not done" and
// re-blocks (then resumes from lastSeq) on the next load rather than leaving a
// partial store looking finished.
export function markFirstSyncDone(username: string, lastSeq: number): Promise<string> {
  return db.syncMeta.put({ username, lastSeq, firstSyncDoneAt: Date.now() });
}

// Advance the op-log cursor after an incremental pull applies a batch. Leaves
// firstSyncDoneAt untouched.
export async function advanceCursor(username: string, lastSeq: number): Promise<void> {
  await db.syncMeta.update(username, { lastSeq });
}

// Tear down synced data on sign-out. The local store holds DECRYPTED bookmarks,
// so a second user on the same device must not read the first's plaintext —
// clear both the data and the bookkeeping. Pass a username to scope it, or omit
// to wipe everything (full sign-out). Called from auth-provider's signOut (and so
// the onSessionInvalid path) alongside clearSession.
export async function clearSyncData(username?: string): Promise<void> {
  if (username) {
    await db.syncMeta.delete(username);
    // TODO: also delete this account's links once link rows carry an owner.
    return;
  }
  await Promise.all([db.links.clear(), db.syncMeta.clear()]);
}
