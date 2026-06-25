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

// The plaintext of `links/{id}.enc` — the USER-AUTHORED half of one link. Small by
// design (< ~2 KB budget): list-view fields only, so the whole library is browsable
// offline after first sync. The machine-derived half (the extracted title/image, the
// archive/screenshot refs, the extraction bookkeeping) lives in `extractions/{id}.enc`
// — split BY WRITER so a background extractor never read-merge-writes this file and so
// can never clobber a concurrent user edit under LWW (see docs/link-extraction.md "the
// data model"). Heavy media itself (archive/screenshot/preview bytes, long notes) lives
// in separate `files/{id}.enc` blobs referenced by id — never inlined. `tagIds`/`listId`
// hold ids of `tags/{id}.enc` / `lists/{id}.enc` files; a dangling id (tag deleted on
// another device) is NORMAL and the UI skips it, never errors.
//
// Reference fields end in `Id`/`Ids` and store the BARE entity id, never a full
// path: the `{namespace}` prefix + `.enc` suffix is applied at the read edge
// (paths.ts), the same convention the link's own `links/{id}.enc` path follows.
// Char caps for the inline, user-/extraction-written text fields — the single
// source of truth the input edge, the extractor, and this schema all share, so the
// limit can't drift between where it's enforced and where it's validated. They
// protect the `< ~2 KB` metadata budget (see local-first-sync.md "metadata vs
// content"); counts are UTF-16 length, so worst-case multi-byte text stays bounded.
// Keep them GENEROUS: because these schemas parse persisted bytes, a value over the
// cap fails to parse and drops the record from the UI (the link for `customTitle`/
// `note`, the extraction for its `title`) — so the cap must never trip a legitimate
// value, and writers (the editor, the extractor truncating og:title) enforce the same
// number up front. The same `LINK_TITLE_MAX` is shared by `customTitle` and
// `extractionSchema.title` so a title can't be valid in one file but not the other.
// `url` is deliberately NOT capped: it
// is the link's identity, so truncating it would corrupt the link — the per-user
// byte quota is its only backstop.
export const LINK_TITLE_MAX = 300; // shared by `linkSchema.customTitle` + `extractionSchema.title` (a title either way)
export const LINK_NOTE_MAX = 500; // short inline note; long-form → files/ (`noteId`)

export const linkSchema = z.looseObject({
  // Uncapped on purpose — the link's identity must never be truncated (see the
  // `LINK_TITLE_MAX` note above); the per-user byte quota is the only backstop.
  url: z.string(),
  // Tag ids (the `{id}` of `tags/{id}.enc`). Order is the user's tag order.
  tagIds: z.array(z.string()),
  // List id (the `{id}` of `lists/{id}.enc`).
  listId: z.string(),
  // The user's DELIBERATE title/image override. The UI resolves the displayed title as
  // `customTitle ?? extraction.title ?? host(url)` and the image as
  // `customImageId ?? extraction.imageId`, so a manual edit always wins over the
  // extracted/discovered value (which lives in `extractions/{id}.enc`). Because the two
  // writers now own SEPARATE FILES — the user this one, extraction the extractions file
  // — re-running or tier-upgrading extraction can't touch these at all, and clearing
  // one reverts to the still-present extracted value. A title the user types AT SAVE is
  // deliberate too, so it lands here. (A title that merely RODE IN from a bulk import is
  // NOT deliberate — it seeds the provisional `extraction.title`, which extraction may
  // still upgrade — see docs/link-extraction.md.) `customImageId` is a `files/{id}.enc`
  // ref to a user-picked image, the same heavy-media rule as `extraction.imageId`.
  //
  // These live here in `links/` — one file, one user gesture, beside `tagIds`/`listId`
  // — NOT a separate entity/file. A manual override is a low-frequency USER edit, the
  // opposite of the churny automated state that earns `pins/` and `extractions/` their
  // own LWW-isolated files; a shadow override file would only force a single edit to
  // write two files and race under LWW.
  customTitle: z.string().max(LINK_TITLE_MAX).optional(),
  customImageId: z.string().optional(),
  // The user's own free-text note on the link — their annotation, NOT the page's
  // extracted description/summary (that's the extraction `summary` facet; a field
  // named `note` is always the user's words). Kept INLINE so it shows in the list
  // view and stays searchable offline like `customTitle`/`url` — and therefore CAPPED to
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

// The plaintext of `extractions/{id}.enc` — EVERYTHING a machine derives about a link,
// with `id` repeating the link's id (the `{id}` of its `links/{id}.enc`), so it's
// self-contained AND its own last-writer-wins point. This is the MACHINE-WRITTEN half
// of a link; `links/{id}.enc` is the USER-WRITTEN half. The split is by WRITER, which
// is the property that matters: extraction writes only THIS file, so it can never
// read-merge-write the user's file and clobber a concurrent list/tag/title edit under
// LWW — the one unrecoverable race the old "display result in links/" layout risked. It
// carries two kinds of machine state, both written by the SAME writer (the extractor),
// so LWW races between them are self-healing (re-extract is idempotent):
//   1. the DISPLAY RESULT — `title` (the discovered/provisional og:title), `imageId`
//      (og:image preview), `pageArchiveId`, `screenshotId` (heavy `files/{id}.enc`
//      refs). The UI resolves `customTitle ?? title ?? host(url)` and
//      `customImageId ?? imageId` (the `custom*` halves live in `linkSchema`).
//   2. the BOOKKEEPING — the per-facet who/when/quality/retry map (`facets`).
// A bulk-imported title (not a deliberate user name) seeds the provisional `title` here,
// where extraction may still upgrade it — it does NOT go in `customTitle`. Written by
// client extractors (the extension, future Expo app, the web app orchestrating
// brace-extractor or an import), NEVER by `brace-api`, which stays a blind sync broker.
// The work loop is a QUERY, not a queue object: a link with no `done` `titleImage`
// facet (no extractions file at all, or one not yet extracted) is pending. See
// docs/link-extraction.md.
//
// A link is NOT one extraction with one lifecycle: title+image, read-mode, screenshot,
// archive, keywords, tags, summary, and (deferred) vectors are INDEPENDENT jobs — each
// produced by a different client/tier at a different time, each able to be missing while
// another is `done`. So the entity carries a MAP of facet → state (`facets`), not a flat
// `status`. One flat file per link with the facets inside (not one prefix per facet): a
// per-facet split would multiply objects ~8× and only guard a rare, self-healing race —
// see the doc's "path layout" note.

// One facet's state — the who/when/quality/retry questions answered independently per
// job. `z.looseObject` so a newer client adding a field round-trips through older ones
// (the file-wide rule above).
export const facetSchema = z.looseObject({
  // No `pending`: a facet no client has touched simply has NO entry (and a link with no
  // extractions file has none at all) — absence IS pending. `done` = success; `failed` =
  // transient, retry once `now >= extractedAt + backoff(attempts)`; `permanent` = hard
  // failure (404/410, robots block), never retry. Because this is SYNCED, one device's
  // `permanent`/`failed` stops every device retrying.
  status: z.enum(['done', 'failed', 'permanent']),
  // WHO ran the last attempt — a `platform:env` string (`extension:fg`, `expo:fg`,
  // `expo:bg`, `server`), NOT a device id: nothing reads this for identity
  // (there's no claim lease and no per-device coordination — see below), only for
  // QUALITY. (The extension is active-context only, so it emits `:fg` only — never an
  // `extension:bg`; the `:bg` tier comes from Expo background / `brace-extractor`. See
  // docs/link-extraction.md "the extension is active-context only".)
  // Quality (the upgrade axis) is DERIVED from it by the shared `tierOf()` helper
  // — `:fg` → active-page beats `:bg` → bg-fetch beats `server` — so a client whose
  // derived tier beats a `done` facet's may re-extract to UPGRADE it. There is no stored
  // `tier` field: it's a pure function of `extractedBy`, and a derived value sitting
  // beside its input is the same drift-prone two-field invariant we avoid with
  // `nextEligibleAt` below. Kept a `z.string()` (not an enum) so a future platform/env a
  // newer client emits round-trips through older ones (the file-wide rule) instead of
  // failing to parse; `tierOf()` ranks an unrecognized value conservatively low so it
  // never wrongly out-ranks a known active-page result.
  extractedBy: z.string().optional(),
  extractedAt: z.number().int().optional(), // when — success time when done, last try when failed
  attempts: z.number().int(), // backoff counter — retry when now >= extractedAt + backoff(attempts)
  // No claim lease (`claimedBy`/`claimedAt`): a rare double-extraction is resolved by
  // idempotency + file-level LWW, not prevented by a synced lease (which would force an
  // extra round-trip on the critical path yet stay best-effort anyway). No
  // `nextEligibleAt` either — it's derived from `extractedAt` + `attempts` via the shared
  // `backoff()` curve. See docs/link-extraction.md "the extraction entity".
});
export type Facet = z.infer<typeof facetSchema>;

// A link carries only the facets some client has finished — `titleImage` done while
// `screenshot` is still missing, etc. — so `facets` is a PARTIAL record: a missing facet
// key means "no client has done this job yet" = pending. `z.partialRecord`, not
// `z.record`, because the latter over an enum key infers an EXHAUSTIVE `Record` (all 8
// required) — which neither matches reality nor parses a real one-facet extraction. The
// display fields are the results of specific facets: `title`/`imageId` from `titleImage`,
// `pageArchiveId` from `archive`, `screenshotId` from `screenshot`; each is absent until
// its facet lands. All but the inline `title` are `files/{id}.enc` refs — "a field name
// types its blob" (see docs/local-first-sync.md "plaintext typing").
export const extractionSchema = z.looseObject({
  id: z.string(), // = the link's id (the `{id}` of `links/{id}.enc`)
  // The discovered/provisional title (og:title, or a bulk-imported title meanwhile),
  // capped like `customTitle` (shared LINK_TITLE_MAX). The UI shows
  // `customTitle ?? title ?? host(url)`, so this is the fallback below a user override.
  title: z.string().max(LINK_TITLE_MAX).optional(),
  // The page's og:image / lead-image preview — a `files/{id}.enc` ref, downloaded and
  // encrypted by the extracting client, NEVER the remote URL (see the doc's "the preview
  // image is a downloaded blob"). Shown as `customImageId ?? imageId`.
  imageId: z.string().optional(),
  // The archived page's content file (`files/{id}.enc`), from the `archive` facet.
  pageArchiveId: z.string().optional(),
  // The full-page screenshot (`files/{id}.enc`), from the `screenshot` facet — a rendered
  // capture, distinct from the og:image `imageId`. Active-page tier only (the extension's
  // `tabs.captureVisibleTab`).
  screenshotId: z.string().optional(),
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

// --- the two shared extraction helpers (every client must agree) -------------
//
// Both live HERE in `shared`, not in any client, so the extension, the future Expo
// app, and `brace-extractor` rank quality and pace retries by identical rules — the
// reason the docs (link-extraction.md "the extraction entity") put them in `shared`.
// Neither value is stored on the facet: each is a pure function of a stored input
// (`extractedBy`, `attempts`/`extractedAt`), so there's no drift-prone second field to
// keep in sync (the same reason there's no `tier` / `nextEligibleAt` column).

// QUALITY rank derived from a facet's `extractedBy` (`platform:env`, e.g.
// `extension:fg`). Higher = better: active-page (`:fg`, live DOM / WebView) beats
// bg-fetch (`:bg`, raw HTML) beats `server` (brace-extractor). An UNRECOGNIZED value
// ranks 0 — conservatively lowest — so a future platform/env a newer client emits
// (round-tripped through `looseObject`) can never wrongly out-rank a known active-page
// result. A client may re-extract (UPGRADE) a `done` facet only when its own tier is
// strictly higher than the facet's.
export function tierOf(extractedBy: string | undefined): number {
  if (!extractedBy) return 0;
  if (extractedBy.endsWith(':fg')) return 3; // active-page — live DOM / WebView
  if (extractedBy.endsWith(':bg')) return 2; // background — raw-HTML fetch
  if (extractedBy === 'server') return 1; // brace-extractor (deferred)
  return 0; // unknown → conservatively lowest
}

// Retry pacing for a TRANSIENT `failed` facet: the deciding client retries once
// `now >= extractedAt + backoff(attempts)`. `attempts` is the number of tries so far
// (1 after the first failure), so the delay grows exponentially from a base and is
// capped — long enough that a flaky host isn't hammered, bounded so a link isn't
// stuck forever. A HARD failure is `status: 'permanent'` instead (never retried), so
// this curve only ever paces transient retries.
export const EXTRACTION_BACKOFF_BASE_MS = 5 * 60 * 1000; // 5 min after the first failure
export const EXTRACTION_BACKOFF_MAX_MS = 24 * 60 * 60 * 1000; // capped at 1 day
export function backoff(attempts: number): number {
  if (attempts <= 0) return 0;
  return Math.min(EXTRACTION_BACKOFF_BASE_MS * 2 ** (attempts - 1), EXTRACTION_BACKOFF_MAX_MS);
}

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
