// The two shared extraction POLICY helpers — quality ranking and retry pacing —
// that every client must agree on. They operate on the `facetSchema` fields in
// entities.ts (`extractedBy`, `attempts`/`extractedAt`) but are kept here, beside
// each other rather than in the schema file, the same split `rank.ts`/`tree.ts`
// make: entities.ts is the plaintext SHAPE contract; this is the BEHAVIOR.
//
// Both live in `shared`, not in any client, so the extension, the future Expo app,
// and `brace-extractor` rank quality and pace retries by identical rules — the
// reason the docs (link-extraction.md "the extraction entity") put them in `shared`.
// Neither value is stored on the facet: each is a pure function of a stored input
// (`extractedBy`, `attempts`/`extractedAt`), so there's no drift-prone second field
// to keep in sync (the same reason there's no `tier` / `nextEligibleAt` column).

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
