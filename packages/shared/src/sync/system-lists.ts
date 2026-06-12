// Virtual system lists — client-provided, NOT synced `lists/{id}.enc` entities.
// Part of the cross-platform data contract (the id space for a link's `list`
// field — see entities.ts), so they live here in `shared` beside the schemas,
// not in any one app.
//
// "My List", "Archive", and "Trash" exist on every account, so there's nothing
// user-specific to encrypt or sync: they're modeled as constant ids + UI names
// here in code, not as ciphertext. (Seeding them as real entities would mean
// redundant blobs, and two devices seeding independently would race to create
// DUPLICATE "My List" files — constant ids avoid that.) A link belongs to one of
// them exactly like any user list, via its `list` id (`link.list === id`), so
// filtering stays uniform across system and user lists.
//
// Because these ids are the same on every account, they leak nothing in the URL —
// unlike a user list/tag, whose id is an opaque token and whose name stays
// encrypted in the local store. That's what makes `?list=trash` safe to expose.
//
// RESERVED INVARIANT: the future create-list/tag path must never mint an entity
// id equal to one of these (or ALL_ID) — they're owned by the system namespace.

// `all` is the Show-All pseudo-list (no filter — every link), distinct from the
// three real system lists below. It's a list-param value, not an entity id.
export const ALL_ID = 'all';

export const MY_LIST_ID = 'my-list';
export const ARCHIVE_ID = 'archive';
export const TRASH_ID = 'trash';

// What a brand-new link belongs to, and the default selection a client shows when
// no list is chosen. My List is the default inbox.
export const DEFAULT_LIST_ID = MY_LIST_ID;

// Default display names for the system selections, keyed by id. User list/tag
// names come from the decrypted store instead; these are the only names that live
// in code. NOTE: these are the canonical English labels — when i18n arrives they
// graduate to the translation layer and only the ids stay here.
export const SYSTEM_LIST_NAMES: Record<string, string> = {
  [ALL_ID]: 'Show All',
  [MY_LIST_ID]: 'My List',
  [ARCHIVE_ID]: 'Archive',
  [TRASH_ID]: 'Trash',
};
