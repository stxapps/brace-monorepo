// The sync state VOCABULARY, shared across every client (web, extension, and the
// future native app) — pure data + pure derivation, no React and no browser API,
// so a native client that re-implements the platform-web engine still speaks the
// same status language. The concrete providers (web-react's SyncProvider /
// ExternalSyncProvider, and whatever a native app writes) produce these two
// fields; this module owns the collapse into one phase and the default labels.

// Sync state is TWO dimensions, kept as two fields rather than one enum:
//   storeStatus  — the gate: can the app render local data at all? Durable; once
//                  'ready' it stays 'ready' while cycles come and go.
//   bgSyncStatus — the indicator: health of the current/last background cycle. A
//                  failed background cycle coexists with a usable store (that's
//                  the point of local-first), so it must not leave 'ready'.

// The gate's phases — named for the LOCAL STORE, not the sync runs: on a
// returning visit no initial sync runs at all, yet the store is 'ready'.
export type StoreStatus =
  | 'checking' // reading the flag from the local store
  | 'syncing-initial' // first-ever pull on this device, UI is blocked
  | 'ready' // local store is usable; background sync may still be running
  | 'error'; // initial pull failed; offer retry

// The indicator's phases. Only post-'ready' cycles report here — while the gate
// blocks, the decrypting screen IS the progress UI.
export type BgSyncStatus =
  | 'idle' // no cycle in flight; the last one (if any) succeeded
  | 'syncing' // a background cycle is in flight
  // The cycle COMPLETED, but the server refused part of the push at files/sign.
  // Deliberately NOT 'error': everything else pulled, pushed and committed, the
  // local store is correct, and nothing is retryable by pressing a button — only
  // upgrading or freeing space clears it. Calling that "Sync failed" would send a
  // user hunting for a network problem they don't have, at the exact moment they
  // should be seeing the paywall.
  //
  // TWO statuses, not one, because bracemark-api answers with two distinct codes
  // (lib/quota.ts) that want opposite advice: `upgrade_required` is the free
  // plan's link cap, whose fix is upgrading; `quota_exceeded` is the byte/object
  // backstop every plan shares, whose fix is deleting. Collapsing them sent a
  // paying customer who is out of storage to the subscription page, which cannot
  // help them.
  | 'blocked-plan'
  | 'blocked-capacity'
  | 'error'; // the last cycle failed; requestSync retries (flips back to 'syncing')

// Which gate refused the push — the shared vocabulary behind the two `blocked-*`
// statuses above. 'plan' is `upgrade_required` (the free tier's `maxLinks`);
// 'capacity' is `quota_exceeded` (maxBytes/maxFiles, on any plan).
export type SyncBlockReason = 'plan' | 'capacity';

// What a completed cycle learned beyond "it worked" — the engines' return value,
// read by each platform's SyncProvider to pick its bgSyncStatus. Shared so the
// two sibling engines (web-react, expo-react) and their providers can't drift on
// the meaning.
//
// Collected as a MUTABLE accumulator threaded down the push chain (the cycles →
// pushPending → pushPuts → signPushable) rather than bubbled up through return
// types: the refusal is learned four frames below the only caller that reports
// it, and every frame in between already returns something else. Adding a field
// here costs one write at the bottom instead of a wider tuple in each frame.
export interface SyncOutcome {
  // The gate that refused, or null when nothing was refused. The cycle still
  // completed either way: pulls landed, deletes committed, and every put the
  // gate didn't refuse was uploaded — so this is a state to SURFACE, not a
  // failure to retry. It clears by itself on the next cycle once the account is
  // upgraded or back under its limits.
  blockedBy: SyncBlockReason | null;
  // How many pending ops the gate refused this cycle — the "12 links aren't
  // syncing" detail. NOT the pending-queue length: that also counts ops which
  // simply haven't been reached yet, so it would overstate the problem.
  blockedCount: number;
}

// A fresh accumulator for one cycle.
export function emptySyncOutcome(): SyncOutcome {
  return { blockedBy: null, blockedCount: 0 };
}

// Record one refusal onto the cycle's accumulator. Owned here, not written out in
// each engine, so the two siblings can't drift on the precedence rule:
// 'capacity' OUTRANKS 'plan' when a single cycle hits both, because being out of
// bytes blocks every namespace (no subset of the push gets through) while the
// link cap blocks only `links/` — so capacity is both the larger blockage and
// the one whose advice ("free some space") still applies after an upgrade.
export function recordBlocked(outcome: SyncOutcome, by: SyncBlockReason, count: number): void {
  outcome.blockedCount += count;
  if (outcome.blockedBy === null || by === 'capacity') outcome.blockedBy = by;
}

// The indicator a COMPLETED cycle settles to. Owned here so both providers turn
// an outcome into a status identically — the mapping is the whole reason the
// engines bother to report a reason at all.
export function bgStatusForOutcome(outcome: SyncOutcome): BgSyncStatus {
  if (outcome.blockedBy === 'capacity') return 'blocked-capacity';
  if (outcome.blockedBy === 'plan') return 'blocked-plan';
  return 'idle';
}

// The collapsed one-dimensional phase, in priority order: the gate (store)
// outranks the indicator (bg) — while the store is still checking/pulling/failed
// there's no background cycle to report (cycles only run post-'ready').
export type SyncPhase =
  | 'checking' // reading the first-sync flag from the local store
  | 'initial-syncing' // first-ever pull on this device
  | 'initial-error' // initial pull failed → retryInitialSync
  | 'syncing' // a background cycle is in flight
  | 'cycle-error' // the last background cycle failed → requestSync retries
  | 'plan-blocked' // cycle fine, but the plan's link cap refused part of the push
  | 'capacity-blocked' // cycle fine, but the byte/object quota refused part of it
  | 'idle'; // settled; the last cycle (if any) succeeded

// Shared derivation of the user-facing sync status. Every status surface —
// bracemark-web's Settings→Data card, the extension popup's pill and detail view —
// collapses the two fields into ONE phase the same way. This owns that collapse
// so the surfaces can't drift; each surface still picks its own presentation
// (icons, actions, short pill labels) on top of the phase.
export function getSyncPhase(store: StoreStatus, bg: BgSyncStatus): SyncPhase {
  if (store === 'checking') return 'checking';
  if (store === 'syncing-initial') return 'initial-syncing';
  if (store === 'error') return 'initial-error';
  if (bg === 'syncing') return 'syncing';
  if (bg === 'error') return 'cycle-error';
  // After 'error': a cycle that both failed AND hit the quota gate is reported
  // as failed, since the failure is the part a retry can still fix.
  if (bg === 'blocked-capacity') return 'capacity-blocked';
  if (bg === 'blocked-plan') return 'plan-blocked';
  return 'idle';
}

// The default user-facing label per phase. Surfaces may override where they
// have better information (e.g. "Last synced 5 min ago" instead of idle's
// "Up to date" when lastSyncAt is known).
export const SYNC_PHASE_LABELS: Record<SyncPhase, string> = {
  checking: 'Checking your data…',
  'initial-syncing': 'Setting up this device…',
  'initial-error': 'Initial sync failed',
  syncing: 'Syncing…',
  'cycle-error': 'Sync failed',
  // Both name the effect first, not the cause: the user's library is fine and
  // their other changes did sync, so neither must read as breakage. The surfaces
  // add the call to action on top — and it differs, which is the whole reason
  // these are two phases (see BgSyncStatus).
  'plan-blocked': 'Some changes aren’t syncing',
  'capacity-blocked': 'Some changes aren’t syncing — storage full',
  idle: 'Up to date',
};

// The detail line under the label, given how many ops the gate refused. Shared
// because all three status surfaces (both Data cards, the extension popup) want
// the same sentence; `count` is SyncOutcome.blockedCount as carried on the
// context. Falls back to the vaguer wording at 0, which a surface can still
// reach if it renders a blocked phase restored from a mirror that predates the
// count.
export function syncBlockedDetail(phase: SyncPhase, count: number): string | null {
  const what = count > 0 ? `${count} ${count === 1 ? 'change' : 'changes'}` : 'Some changes';
  if (phase === 'plan-blocked') {
    return `${what} can’t sync because your plan’s link limit is full. Upgrade to sync them.`;
  }
  if (phase === 'capacity-blocked') {
    return `${what} can’t sync because your storage is full. Free up space to sync them.`;
  }
  return null;
}

// A coarse "N min ago" for last-synced lines — good enough for a status blurb,
// no date lib needed.
export function formatSyncedAt(ts: number): string {
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  return new Date(ts).toLocaleDateString();
}
