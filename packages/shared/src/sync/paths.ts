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

// The well-known path of the general settings file (`settingsGeneralSchema`). The
// `settings/` family is keyed by a fixed concern name, not a random id, so its
// paths are baked into client code rather than generated — one source of truth so
// the read/write edges can't drift on the literal. (`general` is the first such
// concern; a new concern adds its own `SETTINGS_<NAME>_PATH` const beside this.)
export const SETTINGS_GENERAL_PATH = `${SETTINGS_PREFIX}general${ENC_SUFFIX}`;

// The id-keyed namespaces — every prefix whose path is `{prefix}{randomId}.enc`.
// `settings/` is excluded on purpose: its segment is a fixed lowercase concern
// name, not a random id, so it's validated as its own shape.
//
// `syncPathSchema` (sync/endpoints.ts) BUILDS its wire-validation regex from this
// list instead of re-listing the namespaces as literals — so adding a namespace is
// just: add the `*_PREFIX` const above, add it here, add its entity schema. The
// server gate can't silently drift from the path contract, and `paths.spec.ts`
// fails if a new `*_PREFIX` isn't reachable through validation at all.
export const ID_KEYED_PREFIXES = [
  META_PREFIX,
  LISTS_PREFIX,
  TAGS_PREFIX,
  FILES_PREFIX,
  PINS_PREFIX,
] as const;
