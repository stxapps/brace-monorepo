// The `items` / R2 key namespaces — the storage path contract every client and
// the API agree on. One decrypted blob per path; the prefix TYPES the blob (see
// docs/local-first-sync.md "plaintext typing" and the schemas in entities.ts). A
// path is `{namespace}{id}.enc` — except `settings/`, keyed by concern name
// rather than an id (`settings/<concern>.enc`).
//
// These live in `shared` so the server (brace-api), the web read layer, and a
// future native client all reference ONE definition instead of hardcoding
// 'meta/' / 'files/' literals that can silently drift apart.
//
// The trailing slash is part of each constant: it's what makes a key-range
// `startsWith` scan exact (no `metaX/` bleed) and a path unambiguously
// namespace-prefixed.

// The always-resident bookmark index — `meta/{id}.enc` (one bookmark per blob).
export const META_PREFIX = 'meta/';
// User lists — `lists/{id}.enc`.
export const LISTS_PREFIX = 'lists/';
// User tags — `tags/{id}.enc`.
export const TAGS_PREFIX = 'tags/';
// Heavy content (archived page, screenshot) fetched LAZILY — `files/{id}.enc`.
export const FILES_PREFIX = 'files/';
// Pinned-link markers — `pins/{id}.enc`, where `{id}` is the pinned link's id (so
// `pins/{id}.enc` shadows `meta/{id}.enc`). One small file per pinned link.
export const PINS_PREFIX = 'pins/';
// Concern-scoped settings — `settings/<concern>.enc`.
export const SETTINGS_PREFIX = 'settings/';

// The encrypted-blob suffix every path ends with.
export const ENC_SUFFIX = '.enc';
