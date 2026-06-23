import type { BgSyncState, ExtractionFacet, StoreStatus } from '@stxapps/web-react';

// The typed popup → background message protocol (replaces the starter's single
// `SAVE_PAGE`). The background owns ALL privileged / CORS-exempt work — the sync
// cycle and every capture — so the popup never fetches brace-api or touches a tab
// directly; it sends one of these and renders the result.
export type ExtensionMessage =
  | { type: 'KICK_SYNC' } // run a sync cycle now (e.g. right after a local edit)
  | { type: 'EXTRACT'; linkId: string; facet: ExtractionFacet } // capture one facet of one link
  | { type: 'GET_SYNC_STATUS' }; // read the latest mirrored sync status

// What each message resolves to. A `{ ok }` envelope for the imperative commands;
// the live status for the query.
export interface MessageResponses {
  KICK_SYNC: { ok: boolean; error?: string };
  EXTRACT: { ok: boolean; error?: string };
  GET_SYNC_STATUS: SyncStatus;
}

// The background mirrors its sync health here (browser.storage.local) every cycle,
// so the popup and the options/status page can render it WITHOUT mounting the sync
// engine (SyncProvider). `storeStatus` reuses web-react's gate phases; `bgSync` its
// indicator phases. `lastSyncAt` is the epoch ms the last cycle finished (success or
// fail); `lastError` is the last cycle's error message, or null.
export interface SyncStatus {
  storeStatus: StoreStatus;
  bgSync: BgSyncState;
  lastSyncAt: number | null;
  lastError: string | null;
}

export const SYNC_STATUS_KEY = 'syncStatus';

export const INITIAL_SYNC_STATUS: SyncStatus = {
  storeStatus: 'checking',
  bgSync: 'idle',
  lastSyncAt: null,
  lastError: null,
};

// Typed wrapper over browser.runtime.sendMessage so call sites get the right
// response type for the message they send.
export function sendMessage<T extends ExtensionMessage>(
  message: T,
): Promise<MessageResponses[T['type']]> {
  return browser.runtime.sendMessage(message) as Promise<MessageResponses[T['type']]>;
}

// Read the mirrored sync status from storage (the popup/options path that doesn't
// round-trip the worker). Falls back to the initial status before the first cycle.
export async function readSyncStatus(): Promise<SyncStatus> {
  const res = await browser.storage.local.get(SYNC_STATUS_KEY);
  return (res[SYNC_STATUS_KEY] as SyncStatus | undefined) ?? INITIAL_SYNC_STATUS;
}

// The background's writer for the mirror.
export async function writeSyncStatus(status: SyncStatus): Promise<void> {
  await browser.storage.local.set({ [SYNC_STATUS_KEY]: status });
}
