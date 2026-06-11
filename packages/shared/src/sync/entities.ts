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
// inlined here. `tags`/`list` hold ids of `tags/{id}.enc` / `lists/{id}.enc`
// files; a dangling id (tag deleted on another device) is NORMAL and the UI
// skips it, never errors.
export const linkSchema = z.looseObject({
  title: z.string(),
  url: z.string(),
  // Tag ids (the `{id}` of `tags/{id}.enc`). Order is the user's tag order.
  tags: z.array(z.string()),
  // List id (the `{id}` of `lists/{id}.enc`).
  list: z.string(),
  // Reference to the archived page's content file (`files/{id}.enc`), absent
  // until one is saved. A field name types its blob (see the doc's "plaintext
  // typing"); if a field ever needs to hold several formats, make it an object
  // with an explicit `type` beside the id — a per-field schema decision.
  pageArchive: z.string().optional(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Link = z.infer<typeof linkSchema>;

// The plaintext of `tags/{id}.enc` / `lists/{id}.enc`. One small file per
// tag/list is what lets two devices rename two DIFFERENT tags concurrently under
// file-level LWW. `id` repeats the path's id so the plaintext is self-contained.
export const tagSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  updatedAt: z.number().int(),
});
export type Tag = z.infer<typeof tagSchema>;

export const listSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  updatedAt: z.number().int(),
});
export type List = z.infer<typeof listSchema>;

// The plaintext of the well-known path `settings/general.enc`. Concern-scoped
// settings files (the LWW-isolation move — see the doc's "data model"): add a
// field here for a general setting, or a NEW `settings/<concern>.enc` schema
// when a group of settings should stop clobbering the rest under LWW.
export const settingsGeneralSchema = z.looseObject({
  updatedAt: z.number().int(),
});
export type SettingsGeneral = z.infer<typeof settingsGeneralSchema>;
