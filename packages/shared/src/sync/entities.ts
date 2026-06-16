import { z } from 'zod';

// Plaintext entity shapes — what's INSIDE the ciphertext of each synced file
// (see docs/local-first-sync.md "data model" + "plaintext typing"). These are a
// cross-platform contract like the blob wire format: every platform encrypts and
// decrypts the same JSON, so the shapes live here in `shared`, not in any app.
//
// Unlike the endpoint contracts next door (endpoints.ts), NOTHING here ever
// crosses the wire in plaintext — the server never sees these fields. The
// schemas exist for the CLIENT read layer: parse a decrypted item's bytes into a
// typed entity before handing it to the UI.
//
// Every object is `z.looseObject` — unknown fields pass through — on purpose.
// Devices upgrade at different times: a newer client may add a field, and an
// older client that parses, edits, re-encrypts, and re-uploads the file must
// ROUND-TRIP that unknown field, not silently strip it (a strict schema would
// make every old-client edit destroy new-client data). For the same reason,
// never repurpose or re-type an existing field — add a new one.
//
// Timestamps are epoch milliseconds, the convention everywhere else in the sync
// system. The `updatedAt` here is the USER-MEANINGFUL edit time, written inside
// the ciphertext by the editing client — distinct from the server-side R2
// `LastModified` that drives sync ordering (an ItemRecord/op-log `updatedAt`),
// which is infrastructure the plaintext doesn't depend on.

// The plaintext of `meta/{id}.enc` — one bookmark ("link" in product language).
// Small by design (< ~2 KB budget): list-view fields only, so the whole library
// is browsable offline after first sync. Heavy content (archives, screenshots,
// long notes) lives in separate `files/{id}.enc` blobs referenced by id — never
// inlined here. `tagIds`/`listId` hold ids of `tags/{id}.enc` / `lists/{id}.enc`
// files; a dangling id (tag deleted on another device) is NORMAL and the UI
// skips it, never errors.
//
// Reference fields end in `Id`/`Ids` and store the BARE entity id, never a full
// path: the `{namespace}` prefix + `.enc` suffix is applied at the read edge
// (paths.ts), the same convention the link's own `meta/{id}.enc` path follows.
export const linkSchema = z.looseObject({
  title: z.string(),
  url: z.string(),
  // Tag ids (the `{id}` of `tags/{id}.enc`). Order is the user's tag order.
  tagIds: z.array(z.string()),
  // List id (the `{id}` of `lists/{id}.enc`).
  listId: z.string(),
  // Id of the archived page's content file (the `{id}` of `files/{id}.enc`),
  // absent until one is saved. A field name types its blob (see the doc's
  // "plaintext typing"); if a field ever needs to hold several formats, make it
  // an object with an explicit `type` beside the id — a per-field schema decision.
  pageArchiveId: z.string().optional(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Link = z.infer<typeof linkSchema>;

// The plaintext of `tags/{id}.enc` / `lists/{id}.enc`. One small file per
// tag/list is what lets two devices rename two DIFFERENT tags concurrently under
// file-level LWW. `id` repeats the path's id so the plaintext is self-contained.
// `parentId`/`rank` give tags and lists a tree: `parentId` is the BARE id of the
// parent entity (its `{id}` in `tags/`|`lists/`), or `null` at the root — never
// `undefined`, so "top-level" is an explicit value a concurrent edit can't be
// confused about. A dangling/cyclic/forbidden parent is reconciled at read time
// (buildTree promotes it to root), exactly like a dangling reference elsewhere.
//
// `rank` is a fractional-index key (see sync/rank.ts) ordering an entity among
// its siblings. It's a STRING, not an index, on purpose: under file-level LWW
// moving one entity must write only that one file — `rank = keyBetween(a, b)`
// inserts between two neighbours without touching them, so concurrent reorders of
// different entities never collide. Required (no legacy entities to back-fill);
// the system-list defaults seed real keys (system-lists.ts) so user entities can
// rank against them.
export const tagSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  rank: z.string(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Tag = z.infer<typeof tagSchema>;

export const listSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  rank: z.string(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type List = z.infer<typeof listSchema>;

// The plaintext of the well-known path `settings/general.enc`. Concern-scoped
// settings files (the LWW-isolation move — see the doc's "data model"): add a
// field here for a general setting, or a NEW `settings/<concern>.enc` schema
// when a group of settings should stop clobbering the rest under LWW.
export const settingsGeneralSchema = z.looseObject({
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type SettingsGeneral = z.infer<typeof settingsGeneralSchema>;
