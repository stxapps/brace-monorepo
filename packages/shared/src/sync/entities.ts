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

// The plaintext of `links/{id}.enc` — one link. Small by design (< ~2 KB
// budget): list-view fields only, so the whole library is browsable offline
// after first sync. Heavy content (archives, screenshots, long notes) lives in
// separate `files/{id}.enc` blobs referenced by id — never inlined here.
// `tagIds`/`listId` hold ids of `tags/{id}.enc` / `lists/{id}.enc` files; a
// dangling id (tag deleted on another device) is NORMAL and the UI skips it,
// never errors.
//
// Reference fields end in `Id`/`Ids` and store the BARE entity id, never a full
// path: the `{namespace}` prefix + `.enc` suffix is applied at the read edge
// (paths.ts), the same convention the link's own `links/{id}.enc` path follows.
// Char caps for the inline, user-/extraction-written text fields — the single
// source of truth the input edge, the extractor, and this schema all share, so the
// limit can't drift between where it's enforced and where it's validated. They
// protect the `< ~2 KB` metadata budget (see local-first-sync.md "metadata vs
// content"); counts are UTF-16 length, so worst-case multi-byte text stays bounded.
// Keep them GENEROUS: because this schema parses persisted bytes, a value over the
// cap fails to parse and drops the WHOLE link from the UI — so the cap must never
// trip a legitimate value, and writers (the editor, the extractor truncating
// og:title) enforce the same number up front. `url` is deliberately NOT capped: it
// is the link's identity, so truncating it would corrupt the link — the per-user
// byte quota is its only backstop.
export const LINK_TITLE_MAX = 300; // `title` + `customTitle` (a title either way)
export const LINK_NOTE_MAX = 500; // short inline note; long-form → files/ (`noteId`)

export const linkSchema = z.looseObject({
  // The link's "discovered/provisional" title — NOT the user's typed title. It
  // holds a URL-host placeholder at save, then is BACKFILLED/overwritten by the
  // `titleImage` extraction facet (see docs/link-extraction.md). Any title the user
  // types — whether at save or in a later edit — goes in `customTitle` below and is
  // sticky, so `title` can be re-extracted or tier-upgraded freely without ever
  // losing the user's words.
  title: z.string().max(LINK_TITLE_MAX),
  // Uncapped on purpose — the link's identity must never be truncated (see the
  // `LINK_TITLE_MAX` note above); the per-user byte quota is the only backstop.
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
  // The link's preview image (the page's og:image / lead image), shown in card and
  // table layouts. A `files/{id}.enc` reference, never inlined — heavy media
  // fetched lazily on scroll (see local-first-sync.md "metadata vs content"), the
  // same rule and pattern as `pageArchiveId`. Distinct from a full-page screenshot
  // (the `screenshot` extraction facet, its own ref). Backfilled by the
  // `titleImage` extraction facet; absent until a client extracts it (a web-only
  // user with no extractor gets none — the "web-only gap").
  imageId: z.string().optional(),
  // The full-page screenshot's content file (the `{id}` of `files/{id}.enc`),
  // absent until the `screenshot` extraction facet captures one. Distinct from
  // `imageId` (the page's og:image preview): this is a rendered capture of the page
  // as the user saw it, written by an active-page-tier client (the extension's
  // `tabs.captureVisibleTab`). Heavy media, fetched lazily on open — same
  // `files/{id}.enc`-ref rule as `pageArchiveId`/`imageId`.
  screenshotId: z.string().optional(),
  // Manual user overrides for the two display fields extraction otherwise owns. The
  // UI renders `customTitle ?? title` and `customImageId ?? imageId`, so a manual
  // edit always wins over the extracted/discovered value. Extraction writes ONLY
  // `title`/`imageId` and NEVER these, so re-running or tier-upgrading extraction
  // can't clobber a user's override — and clearing the field reverts to the fetched
  // value, which is still present. A title the user types AT SAVE counts as an
  // override too (it's sticky), so it lands here, not in `title`. `customImageId`
  // is a `files/{id}.enc` ref (a user-picked/uploaded image), same heavy-media rule
  // as `imageId`.
  //
  // These live here in `links/` — one file, one user gesture, beside
  // `title`/`tagIds`/`listId` — NOT a separate entity/file. A manual override is a
  // low-frequency USER edit, the opposite of the churny automated state that earns
  // `pins/` and `extraction/` their own LWW-isolated files; a shadow override file
  // would only force a single edit to write two files and race under LWW.
  customTitle: z.string().max(LINK_TITLE_MAX).optional(),
  customImageId: z.string().optional(),
  // The user's own free-text note on the link — their annotation, NOT the page's
  // extracted description/summary (that's the extraction `summary` facet; a field
  // named `note` is always the user's words). Kept INLINE so it shows in the list
  // view and stays searchable offline like `title`/`url` — and therefore CAPPED to
  // protect the `< ~2 KB` metadata budget (see local-first-sync.md "metadata vs
  // content"). The cap counts UTF-16 length, so worst-case multi-byte text still
  // stays bounded. Long-form multi-paragraph notes do NOT belong here — those are a
  // separate `files/{id}.enc` blob (a `noteId` ref, deferred), the same lazy
  // heavy-field rule as archives/screenshots.
  note: z.string().max(LINK_NOTE_MAX).optional(),
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

// The plaintext of `pins/{id}.enc` — marks a link as pinned ("pin to the top").
// One file per pinned link, with `id` repeating the link's id (the `{id}` of its
// `links/{id}.enc`), so a pin is self-contained AND its own last-writer-wins point:
// pinning, unpinning, or reordering writes ONLY this file, so it never clobbers a
// concurrent edit to the link's blob (title/tags/list) — the same isolation
// reasoning that gives lists/tags one file each. A flag inside `linkSchema` would
// instead make every pin/reorder rewrite the link and collide under LWW.
//
// `rank` is the fractional-index key (sync/rank.ts) ordering the pinned links
// among THEMSELVES — the user's manual pin order, independent of any view's sort.
// Deliberately NO `listId`: the link already records its list, so a pin needs no
// list scoping and survives the link moving lists untouched. A pin whose link is
// gone (deleted on another device) is a dangling reference the read layer skips,
// exactly like a dangling `tagId`/`listId`.
export const pinSchema = z.looseObject({
  id: z.string(),
  rank: z.string(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Pin = z.infer<typeof pinSchema>;

// The plaintext of `extractions/{id}.enc` — per-link extraction bookkeeping, with
// `id` repeating the link's id (the `{id}` of its `links/{id}.enc`), so it's
// self-contained AND its own last-writer-wins point. Like `pins/`, this is the
// LWW-isolation move applied to CHURNY, AUTOMATED state — who extracted, when, at
// what quality, whether it's claimed, whether it failed and when to retry — written
// by background actors on a different schedule than user edits. Keeping it OUT of
// `linkSchema` means that churn never clobbers a concurrent user title/tag edit and
// never bloats the link's < ~2 KB budget. The DISPLAY result extraction produces
// (`title`/`imageId`/`pageArchiveId`/`screenshotId`) lives in `links/`, NEVER copied
// here — there is one source of truth for the title; `extractions/` answers only
// "who/when/quality/retry?". See docs/link-extraction.md.
//
// A link is NOT one extraction with one lifecycle: title+image, read-mode,
// screenshot, archive, keywords, tags, summary, and (deferred) vectors are
// INDEPENDENT jobs — each produced by a different client/tier at a different time,
// each able to be `pending` while another is `done`. So the entity carries a MAP of
// facet → state (`facets`), not a flat `status`. One flat file per link with the
// facets inside (not one prefix per facet): a per-facet split would multiply objects
// ~8× and only guard a rare, self-healing race — see the doc's "path layout" note.

// One facet's state — the same who/when/quality/retry/lease questions answered
// independently per job. `z.looseObject` so a newer client adding a field round-trips
// through older ones (the file-wide rule above).
export const facetSchema = z.looseObject({
  status: z.enum(['pending', 'done', 'failed']),
  // who/quality produced it — `active-page` beats `bg-fetch` beats `server`; a client
  // whose tier beats a `done` facet's stored tier may re-extract to UPGRADE it.
  tier: z.enum(['active-page', 'bg-fetch', 'server']).optional(),
  extractedBy: z.string().optional(), // client/device id — provenance
  extractedAt: z.number().int().optional(),
  attempts: z.number().int(), // backoff counter for transient failures
  // Don't retry before this. OMITTED together with `status: 'failed'` = a PERMANENT
  // failure (404/410, robots block); present = a transient one eligible to retry.
  // Because this is SYNCED, one device's failure stops every device retrying.
  nextEligibleAt: z.number().int().optional(),
  // Soft TTL lease for cross-device dedup, PER FACET (so the extension claiming
  // `screenshot` doesn't block the phone claiming `summary` on the same link). A
  // soft lease, not a hard lock — file-level LWW resolves the rare race; don't reach
  // for distributed locking for a single user's few devices.
  claimedBy: z.string().optional(),
  claimedAt: z.number().int().optional(),
});
export type Facet = z.infer<typeof facetSchema>;

// A link carries only the facets some client has actually started — `titleImage`
// done while `screenshot` is still missing, etc. — so this is a PARTIAL record:
// every facet key is optional and absent ≠ pending (a missing facet is "no client
// has touched this job yet"). `z.partialRecord`, not `z.record`, because the latter
// over an enum key infers an EXHAUSTIVE `Record` (all 8 required) — which neither
// matches reality nor parses a real one-facet extraction.
export const extractionSchema = z.looseObject({
  id: z.string(), // = the link's id (the `{id}` of `links/{id}.enc`)
  facets: z.partialRecord(
    z.enum([
      'titleImage',
      'readMode',
      'screenshot',
      'archive',
      'keywords',
      'tags',
      'summary',
      'vectors',
    ]),
    facetSchema,
  ),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Extraction = z.infer<typeof extractionSchema>;

// How the links library lays out its rows: `list` (dense default), `card` (a grid
// of previews), `table` (columnar). A cross-platform contract — not a web-only
// union — because the user's choice can be SYNCED (see `settingsGeneralSchema`
// below), so every client must read/write the same string values. The web UI's
// resolved `layout` (see `useSettings`) is one of these.
export const LINKS_LAYOUTS = ['list', 'card', 'table'] as const;
export type LinksLayout = (typeof LINKS_LAYOUTS)[number];

// The plaintext of the well-known path `settings/general.enc`. Concern-scoped
// settings files (the LWW-isolation move — see the doc's "data model"): add a
// field here for a general setting, or a NEW `settings/<concern>.enc` schema
// when a group of settings should stop clobbering the rest under LWW.
//
// `linksLayout` is OPTIONAL: it's the SYNCED links layout (the Settings → Misc
// "Sync" tab). Absent until the user picks one, and an older client that never
// wrote it still parses — `looseObject` round-trips it for clients that don't
// model it yet. The device-local alternative ("Device" tab) lives off-sync in the
// brace-web `localSettings` store, never here.
export const settingsGeneralSchema = z.looseObject({
  linksLayout: z.enum(LINKS_LAYOUTS).optional(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type SettingsGeneral = z.infer<typeof settingsGeneralSchema>;
