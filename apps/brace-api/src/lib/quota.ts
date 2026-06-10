// Per-user storage quota, enforced at `POST /v1/files/sign` (op: 'put') — the one
// place abuse can be bounded when content is opaque (the server can't inspect a
// blob, only count and size it). Checked against the durable per-path size map in
// the user's DO (do/repositories/file-sizes.ts), never the disposable op log. See
// docs/local-first-sync.md "authorization & quota".
//
// These are deliberately generous: ~5 000 bookmarks at 2-3 files each is well
// under MAX_FILES, and metadata is < ~2 KB while content/archives are the bulk —
// so the byte ceiling is what actually bites first for a heavy library. Bump here
// (single source of truth) if real usage approaches them.

// Hard cap on the number of objects a user may store.
export const MAX_FILES = 200_000;

// Hard cap on total stored bytes per user (2 GiB).
export const MAX_BYTES = 2 * 1024 * 1024 * 1024;
