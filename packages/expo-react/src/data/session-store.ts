// Client-only session store backed by expo-secure-store — the platform:expo
// sibling of web-react's data/session-store.ts. The active session — including
// the raw AES `encryptionKey` bytes — is persisted here so an app relaunch
// doesn't force the user back through the password + Argon2id derivation.
//
// Why secure-store and not sqlite/file-system: native has no non-extractable
// CryptoKey handle (see expo-crypto's Account), so at-rest protection must come
// from the storage itself — secure-store is Keychain (iOS) / Keystore-encrypted
// SharedPreferences (Android); sqlite and file-system are plain files. Keeping
// the whole record in one entry also stops the token and key from drifting out
// of sync across two backends — the same one-record invariant as web-react's
// single IDB store. The record is a few hundred bytes, well under secure-store's
// ~2 KB Android advisory limit.
//
// SECURITY: unlike web (XSS), the threat here is at-rest device access; the
// Keychain/Keystore backing is the mitigation. In memory the key is plain bytes
// available to any code in the JS runtime — same trust model as expo-crypto.

import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

import { bytesToHex, hexToBytes } from '@stxapps/shared';

export interface SessionRecord {
  // Public handle, kept for display/UX — not a secret.
  username: string;
  // Bearer token the API authenticates each request with.
  token: string;
  // Epoch ms when the token expires; lets the client pre-empt a stale request.
  expiresAt: number;
  // Raw AES-256-GCM key bytes — native's stand-in for web's non-extractable
  // CryptoKey (no such handle exists here; see expo-crypto's Account).
  encryptionKey: Uint8Array;
}

// The serialized shape that lands in secure-store (string values only). The key
// crosses as hex — the workspace convention for key material over a
// serialization boundary; shared's base64 pair needs `btoa`, which Hermes lacks.
interface PersistedSession {
  username: string;
  token: string;
  expiresAt: number;
  encryptionKeyHex: string;
}

// One active session at a time, under a fixed secure-store key.
const SESSION_KEY = 'brace-session';

// AFTER_FIRST_UNLOCK instead of the WHEN_UNLOCKED default: background sync must
// read the key while the device is locked (any time after the first unlock
// since boot). iOS Keychain semantics — Android ignores the option (its
// Keystore entries are readable whenever the app runs).
const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

// iOS Keychain entries survive app uninstall, so delete-and-reinstall would
// resurrect the old session (stale token, live key) — a signed-in ghost on what
// the user expects to be a clean app. This sentinel file lives in the app
// sandbox (which does die with the app): missing sentinel on load = fresh
// install, wipe any Keychain leftovers. Android uninstall clears secure-store
// too, so the sentinel is only ever load-bearing on iOS.
const INSTALL_SENTINEL = 'brace-install-sentinel';

function installSentinel(): File {
  return new File(Paths.document, INSTALL_SENTINEL);
}

// Both sentinel helpers fail toward "already installed": a broken filesystem
// read must not wipe a valid session on every launch — the reinstall ghost is
// the lesser evil.
function isFreshInstall(): boolean {
  try {
    return !installSentinel().exists;
  } catch {
    return false;
  }
}

function markInstalled(): void {
  try {
    // overwrite makes repeated calls idempotent (the marker carries no content).
    installSentinel().create({ intermediates: true, overwrite: true });
  } catch {
    // Swallowed deliberately — see fail-open note above.
  }
}

// In-memory mirror of the persisted session so synchronous consumers — chiefly
// the api client's auth header — can read the token without an async
// secure-store hit per request. The auth provider hydrates it once via
// loadSession() on launch; saveSession / clearSession keep it in step.
let current: SessionRecord | null = null;

// The live session record (in-memory), or null. Exposes the raw encryptionKey
// for the data layer; NOT expiry-gated (the key still decrypts local data
// offline even after the bearer token has lapsed).
export function getSession(): SessionRecord | null {
  return current;
}

// The bearer token for the Authorization header, or null. Withheld once expired —
// sending a known-stale token would just earn a 401.
export function getToken(): string | null {
  if (!current || current.expiresAt <= Date.now()) return null;
  return current.token;
}

// "The active session is no longer valid" notifier. Fired by the api client when
// the server rejects our bearer token (401) or a request is attempted with an
// expired one; the auth provider subscribes and drops to signed-out. This keeps
// the api client a pure reader — it signals, it doesn't mutate session state. The
// provider stays the sole writer (saveSession/clearSession).
type SessionInvalidListener = () => void;
const invalidListeners = new Set<SessionInvalidListener>();

// Subscribe; returns an unsubscribe fn.
export function onSessionInvalid(listener: SessionInvalidListener): () => void {
  invalidListeners.add(listener);
  return () => invalidListeners.delete(listener);
}

// Notify subscribers — a pure fan-out. Deduping any reaction (e.g. collapsing a
// double sign-out from concurrent failing requests) is the subscriber's concern,
// not this passive store's; it owns the lifecycle being guarded.
export function notifySessionInvalid(): void {
  for (const listener of invalidListeners) listener();
}

function serialize(record: SessionRecord): string {
  const persisted: PersistedSession = {
    username: record.username,
    token: record.token,
    expiresAt: record.expiresAt,
    encryptionKeyHex: bytesToHex(record.encryptionKey),
  };
  return JSON.stringify(persisted);
}

// Null on any malformed payload (bad JSON, missing/mistyped fields) — a corrupt
// entry reads as signed-out rather than throwing into the auth provider.
function parse(raw: string): SessionRecord | null {
  let persisted: Partial<PersistedSession>;
  try {
    persisted = JSON.parse(raw) as Partial<PersistedSession>;
  } catch {
    return null;
  }
  if (
    typeof persisted.username !== 'string' ||
    typeof persisted.token !== 'string' ||
    typeof persisted.expiresAt !== 'number' ||
    typeof persisted.encryptionKeyHex !== 'string'
  ) {
    return null;
  }
  return {
    username: persisted.username,
    token: persisted.token,
    expiresAt: persisted.expiresAt,
    encryptionKey: hexToBytes(persisted.encryptionKeyHex),
  };
}

// Persist (or replace) the current session. Updates the in-memory mirror first
// so synchronous readers see it immediately. Sentinel before the write: if a
// save ever lands before the first loadSession() of a fresh install, the next
// launch's fresh-install wipe must not eat this session.
export async function saveSession(record: SessionRecord): Promise<void> {
  current = record;
  markInstalled();
  await SecureStore.setItemAsync(SESSION_KEY, serialize(record), SECURE_OPTIONS);
}

// Read the persisted session into the in-memory mirror and return it. Called
// once by the auth provider on launch to hydrate; thereafter getSession/getToken
// read the mirror synchronously. On a fresh install this instead wipes any
// Keychain leftover from a previous install (see INSTALL_SENTINEL) and reads as
// signed-out.
export async function loadSession(): Promise<SessionRecord | null> {
  if (isFreshInstall()) {
    await SecureStore.deleteItemAsync(SESSION_KEY, SECURE_OPTIONS);
    markInstalled();
    current = null;
    return null;
  }
  const raw = await SecureStore.getItemAsync(SESSION_KEY, SECURE_OPTIONS);
  const record = raw === null ? null : parse(raw);
  if (raw !== null && record === null) {
    // Corrupt entry: drop it now so it can't shadow a future session.
    await SecureStore.deleteItemAsync(SESSION_KEY, SECURE_OPTIONS);
  }
  current = record;
  return current;
}

export async function clearSession(): Promise<void> {
  current = null;
  await SecureStore.deleteItemAsync(SESSION_KEY, SECURE_OPTIONS);
}
